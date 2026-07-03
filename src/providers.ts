import type { Profile, ResolvedProfile } from './types.js';
import { readConfig, writeConfig, type PairConfig } from './config.js';
import { humanizeProfileName, humanizeModelId, inferTier } from './ui.js';

/**
 * Profiles come from three sources, in precedence order:
 *
 *   1. Environment (never persisted by us):
 *        PAIR_PROFILE_<NAME>_BASE_URL   Anthropic-compatible endpoint
 *        PAIR_PROFILE_<NAME>_KEY        API key / bearer token            (required)
 *        PAIR_PROFILE_<NAME>_MODEL      default model id                  (optional)
 *      …plus the implicit official endpoint via the standard ANTHROPIC_API_KEY
 *      (+ optional ANTHROPIC_BASE_URL).
 *   2. Session profiles entered interactively — in-memory for the session only.
 *   3. Saved profiles the user opted to "remember" — persisted to the on-disk
 *      config (see config.ts). This is the only place a key touches disk.
 *
 * A profile is "ready" only when its key is present, so the picker can only ever
 * offer endpoints that can actually run.
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

/**
 * Save an endpoint to the on-disk config so it survives across sessions. Re-saving
 * the *same endpoint* (matched by baseUrl) overwrites in place — that's how a key
 * is rotated. We match on baseUrl rather than the derived name because the name
 * can be suffixed when it clashes with an env/session profile, and a name-only
 * match would then create a duplicate saved entry instead of rotating the key.
 * Only when no saved entry shares the baseUrl do we mint a fresh (clash-safe) name.
 */
export function persistProfile(input: { baseUrl: string; apiKey: string; name?: string; defaultModel?: string }): ResolvedProfile {
  const baseUrl = input.baseUrl.trim();
  let cfg: PairConfig;
  try {
    cfg = readConfig();
  } catch (err) {
    // Don't swallow a corrupt config on a write path: degrading to an empty
    // config here would overwrite (and destroy) the broken file. Surface a
    // readable error instead so the caller can tell the user to fix it.
    throw new Error(err instanceof Error ? err.message : 'failed to read saved config');
  }
  const existing = Object.keys(cfg.profiles).find(n => cfg.profiles[n].baseUrl === baseUrl);
  const name = existing ?? uniqueName(sanitizeName(input.name ?? deriveName(baseUrl)));
  cfg.profiles[name] = { baseUrl, apiKey: input.apiKey, defaultModel: input.defaultModel };
  writeConfig(cfg);
  return { name, label: humanizeProfileName(name), baseUrl, defaultModel: input.defaultModel, apiKey: input.apiKey };
}

/** Add an interactively-entered endpoint, persisting it only if the user opts in. */
export function addEndpoint(input: { baseUrl: string; apiKey: string; remember: boolean; name?: string; defaultModel?: string }): ResolvedProfile {
  return input.remember ? persistProfile(input) : registerSessionProfile(input);
}

/** Saved (persisted) profiles only, secrets stripped — for the /config manager. */
export function persistedProfiles(): Profile[] {
  return loadPersistedProfiles();
}

/** Delete a saved profile from disk. Returns false if it wasn't saved. */
export function forgetProfile(name: string): boolean {
  let cfg: PairConfig;
  try {
    cfg = readConfig();
  } catch (err) {
    // As in persistProfile: never overwrite a corrupt config on a write path.
    // Surface a readable error so the user can repair the file by hand.
    throw new Error(err instanceof Error ? err.message : 'failed to read saved config');
  }
  if (!(name in cfg.profiles)) return false;
  delete cfg.profiles[name];
  writeConfig(cfg);
  return true;
}

/** Sanitize a profile name to alphanumeric, hyphen, and underscore only. */
function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '-');
}

function deriveName(baseUrl: string): string {
  try {
    const host = new URL(baseUrl).hostname;
    const skip = new Set(['api', 'open', 'www', 'gateway', 'ark', 'dashscope']);
    const label = host.split('.').find(p => !skip.has(p)) ?? host;
    return sanitizeName(label.toLowerCase());
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
    const baseUrl = envValue(`${PROFILE_PREFIX}${raw}_BASE_URL`) ?? '';
    // Validate the base URL — env profiles skip the interactive form's URL
    // check, so a malformed PAIR_PROFILE_<NAME>_BASE_URL would surface later
    // as an opaque request failure. Skip the profile and warn instead.
    if (baseUrl) {
      let url: URL;
      try {
        url = new URL(baseUrl);
      } catch {
        process.stderr.write(`pair-code: skipping profile "${raw.toLowerCase()}": invalid base URL "${baseUrl}"\n`);
        continue;
      }
      // Warn (but don't block) on insecure http:// endpoints. The interactive
      // EndpointForm flags these; env profiles bypass that form, so surface the
      // risk here. Localhost loopback is exempt (local dev proxies).
      if (url.protocol === 'http:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1' && url.hostname !== '::1') {
        process.stderr.write(`pair-code: warning: profile "${raw.toLowerCase()}" uses an insecure http:// base URL "${baseUrl}"\n`);
      }
    }
    profiles.push({
      name: raw.toLowerCase(),
      label: humanizeProfileName(raw),
      baseUrl,
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

  // Saved profiles from the on-disk config (secrets stripped from the listing).
  for (const sp of loadPersistedProfiles()) {
    if (!profiles.some(p => p.name === sp.name)) profiles.push(sp);
  }

  profiles.sort((a, b) => a.label.localeCompare(b.label));
  return profiles;
}

/**
 * Saved profiles from the on-disk config, secrets stripped. If the config is
 * corrupted, degrade to an empty list rather than crashing. Read paths
 * (resolveProfile's saved-key fallback) degrade the same way, while write
 * paths (persistProfile / forgetProfile) instead surface a readable error so
 * they never overwrite — and destroy — a broken file.
 */
function loadPersistedProfiles(): Profile[] {
  let cfg: PairConfig;
  try { cfg = readConfig(); } catch { return []; }
  return Object.entries(cfg.profiles).map(([name, p]) => ({
    name,
    label: humanizeProfileName(name),
    baseUrl: p.baseUrl,
    defaultModel: p.defaultModel,
  }));
}

/**
 * Scan env vars for the API key of a profile by case-insensitive name match.
 * We can't simply reconstruct `PAIR_PROFILE_${name.toUpperCase()}_KEY` because
 * loadProfiles() lowercases the stored name, and the original env var may have
 * been mixed-case (e.g. PAIR_PROFILE_MyService_KEY) which toUpperCase() can't
 * recover on case-sensitive systems.
 */
function findEnvKey(profileName: string): string | undefined {
  const target = profileName.toLowerCase();
  for (const key of Object.keys(process.env)) {
    if (!key.startsWith(PROFILE_PREFIX) || !key.endsWith('_KEY')) continue;
    const raw = key.slice(PROFILE_PREFIX.length, key.length - '_KEY'.length);
    if (raw.toLowerCase() === target) return envValue(key);
  }
  return undefined;
}

/** Resolve a profile *with* its secret, for use at turn time. */
export function resolveProfile(name: string): ResolvedProfile | undefined {
  const session = sessionProfiles.get(name);
  if (session) return session;
  const base = loadProfiles().find(p => p.name === name);
  if (!base) return undefined;

  // Environment takes precedence over a saved key with the same name.
  const envKey = name === 'anthropic'
    ? envValue('ANTHROPIC_API_KEY')
    : findEnvKey(name);
  if (envKey) return { ...base, apiKey: envKey };

  // Saved key fallback. A corrupt config yields no usable key — fall through to
  // undefined rather than crashing the turn with a raw parse error.
  let stored: PairConfig['profiles'][string] | undefined;
  try {
    stored = readConfig().profiles[name];
  } catch {
    stored = undefined;
  }
  if (stored?.apiKey) return { ...base, apiKey: stored.apiKey };

  return undefined;
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
  // The official 'anthropic' profile has an empty baseUrl by design. Pin it to
  // the canonical URL explicitly so an ambient exported ANTHROPIC_BASE_URL can't
  // silently redirect the official key to a third-party endpoint. Third-party
  // profiles always carry their own baseUrl.
  env.ANTHROPIC_BASE_URL = resolved.baseUrl || 'https://api.anthropic.com';
  return env;
}

export function profileLabel(name: string, profiles?: Profile[]): string {
  // Accept an optional pre-loaded list so callers that already hold the merged
  // profiles (e.g. a cached loadProfiles() result) don't re-scan env + disk on
  // every label lookup.
  const list = profiles ?? loadProfiles();
  return list.find(p => p.name === name)?.label ?? humanizeProfileName(name);
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
