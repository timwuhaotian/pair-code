import { resolve } from 'node:path';
import { statSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { Component, createElement } from 'react';
import type { ReactNode } from 'react';
import { render, Text, Box } from 'ink';
import { App } from './app.js';
import { loadProfiles } from './providers.js';
import { readConfig, configPath } from './config.js';

const execFileAsync = promisify(execFile);

// Derive the version from package.json at runtime so it can't drift from the
// published build. createRequire resolves '../package.json' to the package root
// in both dev (src/) and dist/ layouts; fall back to a literal if that throws
// (e.g. an unusual bundling that inlines this module elsewhere).
const VERSION = ((): string => {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require('../package.json') as { version?: string };
    return pkg.version ?? '0.2.0';
  } catch {
    return '0.2.0';
  }
})();

const CLI_NAME = 'pair';

// Single source of truth for the flags we accept, so #43 (unknown-flag
// detection) and the help text can't disagree about what's recognized.
const HELP_FLAGS = ['--help', '-h'] as const;
const VERSION_FLAGS = ['--version', '-v'] as const;
const KNOWN_FLAGS = new Set<string>([...HELP_FLAGS, ...VERSION_FLAGS]);

function printUsage(): void {
  console.log(`
${CLI_NAME} v${VERSION}
Dual-agent AI pair programming for the terminal (Claude Agent SDK)

Usage:
  ${CLI_NAME} [directory] [task description]
  ${CLI_NAME} providers       List configured endpoint profiles

Options:
  -h, --help      Show this help
  -v, --version   Show version

Endpoints come from the environment (never persisted by us):
  PAIR_PROFILE_<NAME>_BASE_URL   Anthropic-compatible endpoint
  PAIR_PROFILE_<NAME>_KEY        API key / bearer token
  PAIR_PROFILE_<NAME>_MODEL      default model id (optional)
…or the standard ANTHROPIC_API_KEY (+ optional ANTHROPIC_BASE_URL).

You can also enter an endpoint interactively and choose to save it to
  ${configPath()}  (chmod 600)
Env vars take precedence over a saved profile of the same name. Manage saved
credentials in-app with /config; env stays the way to skip the prompt entirely.

Examples:
  ${CLI_NAME} . "Fix the login bug in auth.ts"
  ${CLI_NAME} ~/projects/api "Add rate limiting middleware"
`);
}

function printProfiles(): void {
  const profiles = loadProfiles();
  if (profiles.length === 0) {
    console.log('No endpoint profiles configured. Set PAIR_PROFILE_<NAME>_BASE_URL + _KEY, or ANTHROPIC_API_KEY.');
    return;
  }
  // Compute persisted-ness once via a single guarded read. A per-profile checker
  // (isProfilePersisted) re-reads the config each call and re-throws on a corrupt
  // file, which would crash this read-only listing; degrade to "none saved"
  // instead, with a one-line notice so the corruption isn't silent.
  let persisted = new Set<string>();
  try {
    persisted = new Set(Object.keys(readConfig().profiles));
  } catch {
    console.log('(note: saved config is unreadable; showing env/session profiles only)');
  }
  console.log('Configured endpoint profiles:');
  for (const p of profiles) {
    const saved = persisted.has(p.name) ? '  [saved]' : '';
    console.log(`  • ${p.label}  (${p.baseUrl || 'official anthropic api'})${p.defaultModel ? `  default: ${p.defaultModel}` : ''}${saved}`);
  }
}

/**
 * Warn (non-fatally) if `directory` isn't inside a git work tree. The engine's
 * change tracking shells out to git in this dir; outside a repo getGitChanges()
 * just returns [], so the session still runs — the user only loses the modified-
 * file list. Uses async execFile so startup isn't blocked by a git round-trip.
 */
async function warnIfNotGitRepo(directory: string): Promise<void> {
  let inside = false;
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: directory });
    inside = stdout.trim() === 'true';
  } catch {
    // git missing or not a repo — treat as outside a work tree.
  }
  if (!inside) {
    console.error(`WARNING: ${directory} is not inside a git repository — change tracking will be disabled.`);
  }
}

// ── Error boundary ──────────────────────────────────────────────────────
// Catches render-time errors inside the Ink tree so a broken component shows
// a readable message instead of an opaque raw-mode / React stack crash.

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(): void {
    // Give Ink a tick to paint the fallback UI, then exit non-zero.
    setTimeout(() => process.exit(1), 100);
  }

  render(): ReactNode {
    if (this.state.error) {
      return createElement(
        Box,
        { flexDirection: 'column' },
        createElement(Text, { color: 'red' }, `Something went wrong: ${this.state.error.message}`),
        createElement(Text, { dimColor: true }, 'Please restart the app.'),
      );
    }
    return this.props.children;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Informational flags first so they keep working even when stdin is piped.
  if (args.some(a => (HELP_FLAGS as readonly string[]).includes(a))) { printUsage(); process.exit(0); }
  if (args.some(a => (VERSION_FLAGS as readonly string[]).includes(a))) { console.log(`${CLI_NAME} v${VERSION}`); process.exit(0); }
  if (args[0] === 'providers') { printProfiles(); process.exit(0); }

  // Reject unrecognized dash-flags instead of silently dropping them. (#43)
  const unknownFlag = args.find(a => a.startsWith('-') && !KNOWN_FLAGS.has(a));
  if (unknownFlag) {
    console.error(`Unknown option: ${unknownFlag}`);
    process.exit(2);
  }

  // The interactive UI requires a TTY for Ink raw-mode input; without one
  // (pipe, CI, `docker run` without -t) the first render throws an opaque
  // raw-mode error. Fail fast with a clear message. Must come after the
  // informational handlers above so those still work when piped. (#3/#16/#21)
  if (!process.stdin.isTTY) {
    console.error(`${CLI_NAME} is interactive and needs a TTY (stdin is not a terminal).`);
    process.exit(1);
  }

  const positional = args.filter(a => !a.startsWith('-'));

  // Resolve directory + spec. Documented order is "arg1 = directory, rest =
  // spec". But a single quoted argument like `pair-code "Fix the login bug"`
  // is plainly a task, not a path — it was being treated as a directory and then
  // failing the stat check below. When there's exactly one positional and it
  // contains whitespace (so it can't be a sensible single path/subcommand token),
  // treat it as the spec and default the directory to cwd. A space-free lone
  // positional stays a directory candidate, so a typo'd path or subcommand still
  // surfaces the clear "Not a directory" error from #20 rather than silently
  // becoming a one-word task. (#45)
  let directory: string;
  let initialSpec: string;
  const lone = positional.length === 1 ? positional[0] : undefined;
  if (lone !== undefined && /\s/.test(lone)) {
    directory = process.cwd();
    initialSpec = lone.trim();
  } else {
    directory = resolve(positional[0] || process.cwd());
    initialSpec = positional.slice(1).join(' ').trim();
  }

  // Validate the working directory exists and is a directory. This also turns a
  // typo'd subcommand or bad path into a clear error instead of a downstream
  // git/SDK failure. (#20/#44)
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(directory);
  } catch {
    console.error(`Not a directory: ${directory}`);
    process.exit(1);
  }
  if (!stat.isDirectory()) {
    console.error(`Not a directory: ${directory}`);
    process.exit(1);
  }

  // README requires a git repo for change tracking; warn but don't block. (#20)
  await warnIfNotGitRepo(directory);

  const instance = render(
    createElement(ErrorBoundary, null,
      createElement(App, { directory, initialSpec }),
    ),
  );
  // Observe the render lifecycle so an unhandled error inside Ink surfaces with
  // a non-zero exit rather than being swallowed by a fire-and-forget render.
  instance.waitUntilExit().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}

// Last-resort guards: turn stray throws/rejections into a concise message and a
// non-zero exit instead of a raw V8 stack trace with a misleading exit code. (#18)
process.on('uncaughtException', (err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error(reason instanceof Error ? reason.message : String(reason));
  process.exit(1);
});

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
