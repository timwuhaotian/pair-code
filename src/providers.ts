import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { ProviderKind, ProviderCommand } from './types.js';

interface ProviderInfo {
  cli: string;
  aliases: string[];
  args: (opts: ProviderBuildOpts) => string[];
  detectArgs: string[];
  label: string;
}

interface ProviderBuildOpts {
  model: string;
  sessionId?: string;
  role: 'mentor' | 'executor';
  message: string;
  reasoningEffort?: string;
}

const PROVIDERS: Record<ProviderKind, ProviderInfo> = {
  claude: {
    cli: 'claude',
    aliases: ['claude'],
    detectArgs: ['--version'],
    label: 'Claude Code',
    args: ({ model, sessionId, message }) => {
      const args: string[] = [];
      if (sessionId) args.push('--resume', sessionId);
      args.push('--model', model);
      args.push('--output-format', 'stream-json');
      args.push('--verbose');
      args.push('-p');
      args.push('--dangerously-skip-permissions');
      args.push(message);
      return args;
    },
  },
  opencode: {
    cli: 'opencode',
    aliases: ['opencode'],
    detectArgs: ['--version'],
    label: 'OpenCode',
    args: ({ model, sessionId, message }) => {
      // `opencode run [message..]` — non-interactive mode with JSON output.
      // NOTE: `-p` on this subcommand means `--password`, NOT prompt; pass the
      // message as a positional instead.
      const args: string[] = ['run', '--format', 'json'];
      if (model) args.push('-m', model);
      if (sessionId) args.push('--session', sessionId);
      args.push(message);
      return args;
    },
  },
  codex: {
    cli: 'codex',
    aliases: ['codex'],
    detectArgs: ['--version'],
    label: 'Codex (OpenAI)',
    args: ({ model, sessionId, message }) => {
      // `codex exec` is the non-interactive entry point. Session resumption is
      // its own subcommand: `codex exec resume <id>`.
      if (sessionId) {
        return ['exec', 'resume', sessionId, '--json', '-m', model, message];
      }
      return ['exec', '--json', '-m', model, message];
    },
  },
  gemini: {
    cli: 'gemini',
    aliases: ['gemini'],
    detectArgs: ['--version'],
    label: 'Gemini CLI',
    args: ({ model, sessionId, message }) => {
      const args: string[] = ['-m', model, '-o', 'stream-json', '-y'];
      if (sessionId) args.push('-r', sessionId);
      args.push('-p', message);
      return args;
    },
  },
};

const execAsync = promisify(exec);

export async function detectProviders(): Promise<{ provider: ProviderKind; path: string; version: string }[]> {
  const found: { provider: ProviderKind; path: string; version: string }[] = [];
  const entries = Object.entries(PROVIDERS);
  const results = await Promise.allSettled(
    entries.map(async ([kind, info]) => {
      const { stdout } = await execAsync(`${info.cli} ${info.detectArgs.join(' ')}`, {
        encoding: 'utf-8',
        timeout: 5000,
      });
      return { provider: kind as ProviderKind, path: info.cli, version: (stdout || 'unknown').trim().split('\n')[0] };
    }),
  );
  for (const r of results) {
    if (r.status === 'fulfilled') found.push(r.value);
  }
  return found;
}

export function buildCommand(opts: ProviderBuildOpts & { provider: ProviderKind }): ProviderCommand {
  const info = PROVIDERS[opts.provider];
  return {
    executable: info.cli,
    args: info.args(opts),
  };
}

export function getProviderLabel(kind: ProviderKind): string {
  return PROVIDERS[kind]?.label ?? kind;
}

export function getDefaultModel(provider: ProviderKind): string {
  return MODEL_CATALOGS[provider]?.[0]?.model ?? provider;
}

export interface ModelOption {
  model: string;
  label: string;
  tier?: 'flagship' | 'standard' | 'fast' | 'light';
  /**
   * Upstream provider name when relevant (e.g. OpenCode routes a single
   * model id through multiple back-ends like anthropic / openrouter / groq).
   * Used to disambiguate identical labels and as a fuzzy-search keyword.
   */
  subProvider?: string;
}

// Static fallback catalog — used when CLI-side discovery fails (e.g. CLI not
// authenticated, network down, or no `models` command).
export const MODEL_CATALOGS: Record<ProviderKind, ModelOption[]> = {
  claude: [
    { model: 'claude-opus-4-20250514', label: 'Opus 4', tier: 'flagship' },
    { model: 'claude-sonnet-4-20250514', label: 'Sonnet 4', tier: 'standard' },
    { model: 'claude-haiku-4-20250514', label: 'Haiku 4', tier: 'fast' },
  ],
  opencode: [
    { model: 'opencode/claude-sonnet-4-6', label: 'Claude Sonnet 4.6', tier: 'standard', subProvider: 'opencode' },
    { model: 'opencode/claude-opus-4-7',   label: 'Claude Opus 4.7',  tier: 'flagship', subProvider: 'opencode' },
    { model: 'opencode/gpt-5.1',           label: 'GPT-5.1',          tier: 'standard', subProvider: 'opencode' },
    { model: 'opencode/gemini-3.1-pro',    label: 'Gemini 3.1 Pro',   tier: 'flagship', subProvider: 'opencode' },
  ],
  codex: [
    { model: 'gpt-5.1', label: 'GPT-5.1', tier: 'flagship' },
    { model: 'gpt-5.1-codex', label: 'GPT-5.1 Codex', tier: 'flagship' },
    { model: 'gpt-5.1-codex-mini', label: 'GPT-5.1 Codex Mini', tier: 'fast' },
    { model: 'o4-mini', label: 'o4-mini', tier: 'standard' },
  ],
  gemini: [
    { model: 'gemini-3-pro', label: 'Gemini 3 Pro', tier: 'flagship' },
    { model: 'gemini-3-flash', label: 'Gemini 3 Flash', tier: 'fast' },
    { model: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', tier: 'standard' },
  ],
};

export function getModelsForProvider(provider: ProviderKind): ModelOption[] {
  return MODEL_CATALOGS[provider] ?? [];
}

// ── Runtime model discovery ─────────────────────────────────────────────

const MODEL_DISCOVERY_TIMEOUT_MS = 8_000;
const discoveryCache = new Map<ProviderKind, ModelOption[]>();

/**
 * Probe the underlying CLI for the real model list. Returns the discovered
 * models, or throws if the CLI doesn't expose a model listing in a form we
 * can parse. Callers should catch and fall back to the static catalog.
 */
export async function discoverModels(provider: ProviderKind): Promise<ModelOption[]> {
  const cached = discoveryCache.get(provider);
  if (cached) return cached;

  let result: ModelOption[];
  switch (provider) {
    case 'opencode': result = await discoverOpenCodeModels(); break;
    case 'claude':   result = await discoverClaudeModels();   break;
    case 'codex':    result = await discoverCodexModels();    break;
    case 'gemini':   result = await discoverGeminiModels();   break;
    default:         throw new Error(`No discovery for provider: ${provider}`);
  }
  if (result.length === 0) throw new Error(`Empty model list from ${provider}`);
  discoveryCache.set(provider, result);
  return result;
}

/** Clear the in-process discovery cache (used by /providers refresh). */
export function clearModelDiscoveryCache(): void {
  discoveryCache.clear();
}

async function discoverOpenCodeModels(): Promise<ModelOption[]> {
  // `opencode models` outputs `<sub-provider>/<model-id>` lines.
  // It can be slow on first run because it warms the models.dev cache.
  const { stdout } = await execAsync('opencode models', {
    encoding: 'utf-8',
    timeout: MODEL_DISCOVERY_TIMEOUT_MS,
    maxBuffer: 4 * 1024 * 1024,
  });

  const lines = stdout
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && l.includes('/'));

  return lines.map(line => {
    const slash = line.indexOf('/');
    const sub = line.slice(0, slash);
    const id = line.slice(slash + 1);
    return {
      model: line,
      label: humanizeModelId(id),
      tier: inferTier(id),
      subProvider: sub,
    };
  });
}

async function discoverClaudeModels(): Promise<ModelOption[]> {
  const tryCommands = ['claude models list', 'claude --list-models'];
  for (const cmd of tryCommands) {
    try {
      const { stdout } = await execAsync(cmd, {
        encoding: 'utf-8',
        timeout: MODEL_DISCOVERY_TIMEOUT_MS,
      });
      const lines = stdout
        .split('\n')
        .map(l => l.trim())
        .filter(l => l && /^claude-/.test(l));
      if (lines.length > 0) {
        return lines.map(id => ({ model: id, label: humanizeModelId(id), tier: inferTier(id) }));
      }
    } catch {
      // try next command form
    }
  }
  throw new Error('claude CLI did not expose a model list');
}

async function discoverCodexModels(): Promise<ModelOption[]> {
  // Codex does not currently ship a `models` subcommand. Fall back.
  throw new Error('codex CLI does not expose a model list');
}

async function discoverGeminiModels(): Promise<ModelOption[]> {
  // Gemini CLI currently has no model list command. Fall back.
  throw new Error('gemini CLI does not expose a model list');
}

function inferTier(id: string): ModelOption['tier'] {
  const lower = id.toLowerCase();
  if (/\b(opus|pro|max|flagship|big|ultra)\b/.test(lower)) return 'flagship';
  if (/\b(haiku|mini|flash|nano|fast|small|light)\b/.test(lower)) return 'fast';
  if (/\b(free|tiny)\b/.test(lower)) return 'light';
  return 'standard';
}

const KNOWN_BRANDS: Record<string, string> = {
  gpt: 'GPT',
  glm: 'GLM',
  llm: 'LLM',
  llama: 'Llama',
  qwen: 'Qwen',
  kimi: 'Kimi',
  gemini: 'Gemini',
  gemma: 'Gemma',
  claude: 'Claude',
  grok: 'Grok',
  deepseek: 'DeepSeek',
  minimax: 'MiniMax',
  nemotron: 'Nemotron',
};

// Known acronyms that should stay fully uppercase when they appear as a
// stand-alone segment (e.g. "gpt-4" → "GPT 4").
const ACRONYMS = new Set(['gpt', 'glm', 'llm', 'gpu', 'cpu', 'tts', 'stt', 'ocr']);

function formatSegment(part: string): string {
  const lower = part.toLowerCase();
  if (ACRONYMS.has(lower)) return lower.toUpperCase();
  for (const brand in KNOWN_BRANDS) {
    if (lower.startsWith(brand)) {
      return KNOWN_BRANDS[brand] + part.slice(brand.length);
    }
  }
  if (/^\d/.test(part)) return part;
  return part.charAt(0).toUpperCase() + part.slice(1);
}

function humanizeModelId(id: string): string {
  const last = id.split('/').pop() ?? id;
  const parts = last.split('-');
  const out: string[] = [];
  for (const part of parts) {
    // Merge adjacent numeric segments into a single dotted version
    // (e.g. "claude-opus-4-7" → "Claude Opus 4.7").
    if (/^\d+$/.test(part) && out.length > 0 && /^[\d.]+$/.test(out[out.length - 1])) {
      out[out.length - 1] = out[out.length - 1] + '.' + part;
      continue;
    }
    out.push(formatSegment(part));
  }
  return out.join(' ');
}
