# Contributing to Pair Code

Thanks for your interest in contributing! This guide covers the basics.

## Getting Started

```bash
git clone https://github.com/timwuhaotian/pair-code.git
cd pair-code
npm install
```

Prerequisites:
- **Node.js ≥ 20**
- **npm** (comes with Node)

## Development Workflow

1. Create a branch: `git checkout -b feat/my-feature`
2. Make your changes, following the conventions below.
3. Verify:
   ```bash
   npm run typecheck   # must pass
   npm run lint        # must pass
   npm run build       # must succeed
   npx tsx scripts/preview.tsx   # visually check the UI if you touched components
   ```
4. Commit with a clear message (conventional commits preferred: `feat:`, `fix:`, `docs:`, `refactor:`).
5. Open a pull request against `main`.

## No Test Framework

This project currently has no test suite. To verify changes:
- Run `npm run typecheck` and `npm run lint`.
- Render `scripts/preview.tsx` to check UI changes visually.
- Exercise the CLI manually against a real Anthropic-compatible endpoint.

If you'd like to add a test framework, please open an issue first to discuss the approach.

## Code Conventions

- **ESM only** — `"type": "module"`, no `require()`/CommonJs.
- **Strict TypeScript** — `strict: true`. Type every signature; prefer discriminated unions over `any`.
- **Relative imports** use `.js` extensions even from `.ts`/`.tsx` sources (e.g. `import { foo } from './bar.js'`).
- **No formatter** is configured. Match surrounding style; don't add one without asking.
- **JSX**: `react-jsx` (automatic runtime). In `.tsx`, import the `JSX` type explicitly (`import type { JSX } from 'react'`).

## Module Boundaries

These boundaries are load-bearing — don't mix concerns:

| Module | What it does | What it must NOT do |
|--------|-------------|---------------------|
| `process.ts` | Pair engine | No React, no rendering |
| `providers.ts` | Profile resolution | No React |
| `config.ts` | On-disk config I/O | No profile/merge logic, no React |
| `state.ts` | State mutations | No rendering, no I/O beyond `git status` |
| `components.tsx` | Presentational components | No state mutation |
| `ui.ts` | Theme tokens | No rendering, no state |

## Pair-Engine Invariants

Breaking any of these will silently corrupt the loop:

- **Only the Mentor may emit `TASK_COMPLETE`** on its own line. The Executor's system prompt forbids it.
- **Roles are asymmetric**: Executor has `permissionMode: 'bypassPermissions'` + full tools; Mentor is read-only (`Read`, `Grep`, `Glob` only).
- **Turn timeout is 10 minutes** (`TURN_TIMEOUT_MS`).
- **Mentor reviews must include the structured JSON block** (`{"verdict":…, "risk":…, "nextStep":{…}}`). Don't change the contract without updating `parseVerdict` in `components.tsx`.
- **Session continuity** is per-turn: each turn starts a fresh `query()` with `resume: <sessionId>`.

## Reporting Bugs

Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md). Include:
- Your Node version and OS
- The provider/endpoint you're using
- Steps to reproduce
- Expected vs. actual behavior
- Any error output

## Requesting Features

Use the [feature request template](.github/ISSUE_TEMPLATE/feature_request.md). Describe the use case, not just the solution.

## License

By contributing, you agree that your contributions will be licensed under the Apache-2.0 License.
