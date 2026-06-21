import { resolve } from 'node:path';
import { createElement } from 'react';
import { render } from 'ink';
import { App } from './app.js';
import { loadProfiles } from './providers.js';

const VERSION = '0.2.0';

function printUsage(): void {
  console.log(`
pair-code v${VERSION}
Dual-agent AI pair programming for the terminal (Claude Agent SDK)

Usage:
  pair-code [directory] [task description]
  pair-code providers       List configured endpoint profiles

Options:
  -h, --help      Show this help
  -v, --version   Show version

Endpoints are declared in the environment (never persisted):
  PAIR_PROFILE_<NAME>_BASE_URL   Anthropic-compatible endpoint
  PAIR_PROFILE_<NAME>_KEY        API key / bearer token
  PAIR_PROFILE_<NAME>_MODEL      default model id (optional)
…or the standard ANTHROPIC_API_KEY (+ optional ANTHROPIC_BASE_URL).

Examples:
  pair-code . "Fix the login bug in auth.ts"
  pair-code ~/projects/api "Add rate limiting middleware"
`);
}

function printProfiles(): void {
  const profiles = loadProfiles();
  if (profiles.length === 0) {
    console.log('No endpoint profiles configured. Set PAIR_PROFILE_<NAME>_BASE_URL + _KEY, or ANTHROPIC_API_KEY.');
    return;
  }
  console.log('Configured endpoint profiles:');
  for (const p of profiles) {
    console.log(`  • ${p.label}  (${p.baseUrl || 'official anthropic api'})${p.defaultModel ? `  default: ${p.defaultModel}` : ''}`);
  }
}

function main(): void {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) { printUsage(); process.exit(0); }
  if (args.includes('--version') || args.includes('-v')) { console.log(`pair-code v${VERSION}`); process.exit(0); }
  if (args[0] === 'providers') { printProfiles(); process.exit(0); }

  const positional = args.filter(a => !a.startsWith('-'));
  const directory = resolve(positional[0] || process.cwd());
  const initialSpec = positional.slice(1).join(' ').trim();

  render(createElement(App, { directory, initialSpec }));
}

main();
