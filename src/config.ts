import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync, existsSync, readdirSync, unlinkSync, statSync } from 'node:fs';

/**
 * Opt-in on-disk config. Unlike env/session profiles (process memory only),
 * this file *does* hold secrets — but only the ones the user explicitly chose
 * to "remember" at setup time. It lives under the user's config dir with
 * `0600` perms inside a `0700` dir, the same posture as gh/aws/npm token files.
 */

export interface StoredProfile {
  baseUrl: string;
  apiKey: string;
  defaultModel?: string;
}

export interface PairConfig {
  version: number;
  /** Saved endpoint profiles, keyed by profile name. */
  profiles: Record<string, StoredProfile>;
}

const CONFIG_VERSION = 1;

/**
 * Thrown when the config file exists but its contents aren't valid JSON. Carries
 * the offending path so callers can render a readable "config is corrupt at
 * <path>" message instead of crashing on a raw SyntaxError.
 */
export class CorruptConfigError extends Error {
  readonly path: string;
  constructor(path: string, cause: unknown) {
    super(`config is corrupt at ${path}`, { cause });
    this.name = 'CorruptConfigError';
    this.path = path;
  }
}

/** Config directory, honouring XDG_CONFIG_HOME, else ~/.config/pair-code. */
export function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  return xdg ? join(xdg, 'pair-code') : join(homedir(), '.config', 'pair-code');
}

export function configPath(): string {
  return join(configDir(), 'config.json');
}

/**
 * Read the saved config. Returns an empty config only when the file doesn't
 * exist (first run). If the file exists but is corrupted, a CorruptConfigError
 * propagates — catching it here would cause the next writeConfig() to silently
 * overwrite the broken file and destroy all saved credentials. Callers decide
 * how to surface it (it carries the offending path for a readable message).
 */
export function readConfig(): PairConfig {
  const path = configPath();
  if (!existsSync(path)) return { version: CONFIG_VERSION, profiles: {} };

  let parsed: Partial<PairConfig>;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<PairConfig>;
  } catch (err) {
    throw new CorruptConfigError(path, err);
  }
  const version = typeof parsed.version === 'number' ? parsed.version : CONFIG_VERSION;
  // TODO: future migrations live here — bump CONFIG_VERSION and add a step that
  // transforms the prior shape into the current one before returning. For now we
  // only preserve the on-disk version and warn if it differs from what we expect.
  if (version !== CONFIG_VERSION) {
    process.stderr.write(`pair-code: config version ${version} differs from expected ${CONFIG_VERSION}\n`);
  }
  return {
    version,
    profiles: sanitiseProfiles(parsed.profiles),
  };
}

/**
 * Persist the config. Writes to a temp file with restrictive perms then renames
 * over the target (atomic, never leaving a half-written secret), and keeps the
 * containing dir at 0700 so the key is owner-only.
 */
export function writeConfig(config: PairConfig): void {
  const dir = configDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // mkdir's mode is ignored when the dir already exists, so re-tighten it
  // unconditionally; tolerate non-POSIX filesystems that lack chmod semantics.
  try {
    chmodSync(dir, 0o700);
  } catch {
    /* best-effort: not all filesystems honour POSIX perms */
  }
  // Verify the config directory is owned by the current user — a dir owned by
  // another user could be pre-populated with a tampered config or temp file.
  if (typeof process.getuid === 'function' && statSync(dir).uid !== process.getuid()) {
    throw new Error(`config directory ${dir} is not owned by the current user`);
  }
  const path = configPath();
  // Clean up stale temp files from previous crashed writes — they may contain
  // API keys and would otherwise persist indefinitely.
  try {
    const prefix = basename(path) + '.tmp-';
    for (const f of readdirSync(dir)) {
      if (f.startsWith(prefix)) {
        try { unlinkSync(join(dir, f)); } catch {}
      }
    }
  } catch {}
  const tmp = `${path}.tmp-${process.pid}`;
  const data = JSON.stringify({ ...config, version: CONFIG_VERSION }, null, 2);
  writeFileSync(tmp, data, { mode: 0o600 });
  chmodSync(tmp, 0o600); // writeFileSync ignores mode if tmp already existed
  renameSync(tmp, path);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Keep only entries that describe a runnable saved endpoint: an object with a
 * non-empty string apiKey and a string baseUrl. Malformed entries (non-object,
 * or missing fields) are dropped so they can't surface as ghost profiles in the
 * picker.
 */
function sanitiseProfiles(raw: unknown): Record<string, StoredProfile> {
  if (!isRecord(raw)) return {};
  const out: Record<string, StoredProfile> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue;
    const { apiKey, baseUrl, defaultModel } = value;
    if (typeof apiKey !== 'string' || apiKey.length === 0) continue;
    if (typeof baseUrl !== 'string') continue;
    out[name] = {
      baseUrl,
      apiKey,
      ...(typeof defaultModel === 'string' ? { defaultModel } : {}),
    };
  }
  return out;
}
