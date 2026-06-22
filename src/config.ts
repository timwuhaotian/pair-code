import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync, existsSync } from 'node:fs';

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
 * exist (first run). If the file exists but is corrupted, the error propagates
 * — catching it here would cause the next writeConfig() to silently overwrite
 * the broken file and destroy all saved credentials.
 */
export function readConfig(): PairConfig {
  const path = configPath();
  if (!existsSync(path)) return { version: CONFIG_VERSION, profiles: {} };

  const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<PairConfig>;
  return {
    version: typeof parsed.version === 'number' ? parsed.version : CONFIG_VERSION,
    profiles: isRecord(parsed.profiles) ? (parsed.profiles as Record<string, StoredProfile>) : {},
  };
}

/**
 * Persist the config. Writes to a temp file with restrictive perms then renames
 * over the target (atomic, never leaving a half-written secret), and keeps the
 * containing dir at 0700 so the key is owner-only.
 */
export function writeConfig(config: PairConfig): void {
  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  const path = configPath();
  const tmp = `${path}.tmp-${process.pid}`;
  const data = JSON.stringify({ ...config, version: CONFIG_VERSION }, null, 2);
  writeFileSync(tmp, data, { mode: 0o600 });
  chmodSync(tmp, 0o600); // writeFileSync ignores mode if tmp already existed
  renameSync(tmp, path);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
