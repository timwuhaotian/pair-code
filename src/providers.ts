import type { Profile, ResolvedProfile } from './types.js';

/**
 * Profiles are declared in the environment — we never persist a key to disk.
 * Two shapes are recognised:
 *
 *   PAIR_PROFILE_<NAME>_BASE_URL   Anthropic-compatible endpoint (required for named profiles)
 *   PAIR_PROFILE_<NAME>_KEY        API key / bearer token            (required)
 *   PAIR_PROFILE_<NAME>_MODEL      default model id                  (optional)
 *
 * plus the implicit official endpoint via the standard ANTHROPIC_API_KEY
 * (+ optional ANTHROPIC_BASE_URL). A profile is "ready" only when its key is
 * present, so the picker can only ever offer endpoints that can actually run.
 */

const PROFILE_PREFIX = 'PAIR_PROFILE_';
const PROFILE_SUFFIXES = ['_BASE_URL', '_KEY', '_MODEL'] as const;

function envValue(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

// Profiles entered interactively at runtime. Held in memory for the session
// only — exactly like env vars (process memory), just sourced from keystrokes.
// We never write them to disk, honouring the read-only-secrets invariant.
const sessionProfiles = new Map<string, ResolvedProfile>();

/** Register an endpoint entered interactively; returns the resolved profile. */
export function registerSessionProfile(input: { baseUrl: string; apiKey: string; name?: string; defaultModel?: string }): ResolvedProfile {
  const name = uniqueName(input.name ?? deriveName(input.baseUrl));
  const resolved: ResolvedProfile = {
    name,
    label: humanizeProfileName(name),
    baseUrl: input.baseUrl.trim(),
    defaultModel: input.defaultModel,
    apiKey: input.apiKey,
  };
  sessionProfiles.set(name, resolved);
  return resolved;
}

function deriveName(baseUrl: string): string {
  try {
    const host = new URL(baseUrl).hostname;
    const skip = new Set(['api', 'open', 'www', 'gateway', 'ark', 'dashscope']);
    const label = host.split('.').find(p => !skip.has(p)) ?? host;
    return label.toLowerCase();
  } catch {
    return 'custom';
  }
}

function uniqueName(base: string): string {
  const taken = new Set(loadProfiles().map(p => p.name));
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

/** Discover every ready profile from the environment (no secrets returned). */
export function loadProfiles(): Profile[] {
  const names = new Set<string>();
  for (const key of Object.keys(process.env)) {
    if (!key.startsWith(PROFILE_PREFIX)) continue;
    const suffix = PROFILE_SUFFIXES.find(s => key.endsWith(s));
    if (!suffix) continue;
    names.add(key.slice(PROFILE_PREFIX.length, key.length - suffix.length));
  }

  const profiles: Profile[] = [];
  for (const raw of names) {
    const key = envValue(`${PROFILE_PREFIX}${raw}_KEY`);
    if (!key) continue; // not ready — no secret
    profiles.push({
      name: raw.toLowerCase(),
      label: humanizeProfileName(raw),
      baseUrl: envValue(`${PROFILE_PREFIX}${raw}_BASE_URL`) ?? '',
      defaultModel: envValue(`${PROFILE_PREFIX}${raw}_MODEL`),
    });
  }

  // Implicit official Anthropic endpoint.
  if (envValue('ANTHROPIC_API_KEY') && !profiles.some(p => p.name === 'anthropic')) {
    profiles.push({
      name: 'anthropic',
      label: 'Anthropic',
      baseUrl: envValue('ANTHROPIC_BASE_URL') ?? '',
      defaultModel: envValue('ANTHROPIC_MODEL'),
    });
  }

  // Session profiles entered interactively (secrets stripped from the listing).
  for (const sp of sessionProfiles.values()) {
    if (!profiles.some(p => p.name === sp.name)) {
      profiles.push({ name: sp.name, label: sp.label, baseUrl: sp.baseUrl, defaultModel: sp.defaultModel });
    }
  }

  profiles.sort((a, b) => a.label.localeCompare(b.label));
  return profiles;
}

/** Resolve a profile *with* its secret, for use at turn time. */
export function resolveProfile(name: string): ResolvedProfile | undefined {
  const session = sessionProfiles.get(name);
  if (session) return session;
  const base = loadProfiles().find(p => p.name === name);
  if (!base) return undefined;
  const apiKey = name === 'anthropic'
    ? envValue('ANTHROPIC_API_KEY')
    : envValue(`${PROFILE_PREFIX}${name.toUpperCase()}_KEY`);
  if (!apiKey) return undefined;
  return { ...base, apiKey };
}

/**
 * Build the per-call environment overlay for a single `query()`. Because the
 * pair loop is strictly sequential, two roles on different endpoints never
 * collide — each turn gets its own overlay. Both AUTH_TOKEN and API_KEY are set
 * so official and third-party gateways are both satisfied.
 */
export function profileEnv(resolved: ResolvedProfile): Record<string, string> {
  const env: Record<string, string> = {
    ANTHROPIC_API_KEY: resolved.apiKey,
    ANTHROPIC_AUTH_TOKEN: resolved.apiKey,
  };
  if (resolved.baseUrl) env.ANTHROPIC_BASE_URL = resolved.baseUrl;
  return env;
}

export function profileLabel(name: string): string {
  return loadProfiles().find(p => p.name === name)?.label ?? humanizeProfileName(name);
}

// ── Model suggestions ───────────────────────────────────────────────────
// We can't enumerate an arbitrary Anthropic-compatible endpoint, so we offer a
// curated, brand-keyed suggestion list and always let the user type a custom id.

export interface ModelOption {
  model: string;
  label: string;
  tier?: 'flagship' | 'standard' | 'fast' | 'light';
}

const SUGGESTIONS: Array<{ match: RegExp; models: string[] }> = [
  { match: /anthropic|claude/, models: ['claude-opus-4-1', 'claude-sonnet-4-5', 'claude-haiku-4-5'] },
  { match: /deepseek/, models: ['deepseek-chat', 'deepseek-reasoner'] },
  { match: /glm|zhipu|bigmodel/, models: ['glm-4.6', 'glm-4.5-air'] },
  { match: /kimi|moonshot/, models: ['kimi-k2-0905-preview', 'moonshot-v1-128k'] },
  { match: /qwen|dashscope|bailian/, models: ['qwen3-max', 'qwen3-coder-plus', 'qwen-plus'] },
  { match: /minimax/, models: ['MiniMax-M2', 'abab6.5s-chat'] },
  { match: /openrouter/, models: ['anthropic/claude-sonnet-4.5', 'deepseek/deepseek-chat'] },
];

/** Suggested models for a profile; the profile's own default is pinned first. */
export function suggestModels(profileName: string, defaultModel?: string): ModelOption[] {
  const out: ModelOption[] = [];
  const seen = new Set<string>();
  const push = (model: string) => {
    if (seen.has(model)) return;
    seen.add(model);
    out.push({ model, label: humanizeModelId(model), tier: inferTier(model) });
  };

  if (defaultModel) push(defaultModel);
  for (const s of SUGGESTIONS) {
    if (s.match.test(profileName)) s.models.forEach(push);
  }
  return out;
}

// ── Display helpers ─────────────────────────────────────────────────────

function humanizeProfileName(raw: string): string {
  const lower = raw.toLowerCase();
  for (const brand in KNOWN_BRANDS) {
    if (lower.startsWith(brand)) return KNOWN_BRANDS[brand];
  }
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

function inferTier(id: string): ModelOption['tier'] {
  const lower = id.toLowerCase();
  if (/\b(opus|pro|max|flagship|ultra|m2|reasoner)\b/.test(lower)) return 'flagship';
  if (/\b(haiku|mini|flash|nano|fast|small|light|air)\b/.test(lower)) return 'fast';
  if (/\b(free|tiny)\b/.test(lower)) return 'light';
  return 'standard';
}

const KNOWN_BRANDS: Record<string, string> = {
  gpt: 'GPT',
  glm: 'GLM',
  llama: 'Llama',
  qwen: 'Qwen',
  kimi: 'Kimi',
  gemini: 'Gemini',
  gemma: 'Gemma',
  claude: 'Claude',
  anthropic: 'Anthropic',
  grok: 'Grok',
  deepseek: 'DeepSeek',
  minimax: 'MiniMax',
  moonshot: 'Moonshot',
  openrouter: 'OpenRouter',
  zhipu: 'Zhipu',
};

const ACRONYMS = new Set(['gpt', 'glm', 'llm', 'tts', 'stt', 'ocr', 'ai']);

function formatSegment(part: string): string {
  const lower = part.toLowerCase();
  if (ACRONYMS.has(lower)) return lower.toUpperCase();
  for (const brand in KNOWN_BRANDS) {
    if (lower.startsWith(brand)) return KNOWN_BRANDS[brand] + part.slice(brand.length);
  }
  if (/^\d/.test(part)) return part;
  return part.charAt(0).toUpperCase() + part.slice(1);
}

export function humanizeModelId(id: string): string {
  const last = id.split('/').pop() ?? id;
  const parts = last.split('-');
  const out: string[] = [];
  for (const part of parts) {
    if (/^\d+$/.test(part) && out.length > 0 && /^[\d.]+$/.test(out[out.length - 1])) {
      out[out.length - 1] = out[out.length - 1] + '.' + part;
      continue;
    }
    out.push(formatSegment(part));
  }
  return out.join(' ');
}
