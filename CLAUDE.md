# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`pair-code` is a CLI harness that orchestrates two AI coding agents in a loop: a **Mentor** (plans, reviews) and an **Executor** (writes code). It does **not** import the Anthropic SDK or any LLM client library — it shells out to installed agent CLIs (`claude`, `opencode`, `codex`, `gemini`) and parses their JSON stream output. Treat the local CLI binaries as the runtime, not the network.

## Commands

```bash
npm run build      # tsup → dist/ (ESM, node20 target, with #!/usr/bin/env node banner)
npm run dev        # tsup --watch
npm run start      # build then run dist/index.js
npm run lint       # eslint src  (no .eslintrc — defaults only)
npm run typecheck  # tsc --noEmit
```

- **No test framework is configured.** Don't run `npm test`. To verify changes, run `npm run typecheck` and exercise the CLI manually with `npm run start` against a real provider CLI installed locally.
- **No formatter is configured** (no prettier/biome). Match the surrounding style; don't introduce a formatter without asking.
- Node `>=20.0.0` is required (engines pin).

## Module layout (`src/`)

Keep these boundaries — they're load-bearing:

- `index.ts` — CLI entry, interactive setup, slash-command dispatch
- `process.ts` — pair engine: spawns agent subprocesses, runs the turn loop
- `prompt.ts` — interactive input (slash-command capture, selection UIs)
- `providers.ts` — provider detection, CLI argv construction per provider
- `state.ts` — `PairState` mutations only (no rendering, no I/O beyond `git status -s`)
- `render.ts` / `ui.ts` — terminal rendering (chalk, log-update); no state mutation
- `types.ts` — shared types and discriminated unions (`PairStatus`, `MessageType`, etc.)

Don't mix concerns across these files (e.g., don't mutate state from `render.ts`, don't render from `state.ts`).

## TypeScript / module conventions

- `"type": "module"` + `moduleResolution: "bundler"`. Relative imports must use `.js` extensions (e.g., `import { foo } from './state.js'`) even though sources are `.ts`.
- `strict: true` is on. Type every function signature; prefer discriminated unions over `any`.
- ESM only — no `require()`, no CommonJS-style exports.

## Pair-engine invariants

Breaking any of these will silently corrupt the loop:

- **Only the Mentor may emit `TASK_COMPLETE`**, and it must appear on its own line. The Executor's system prompt explicitly forbids this sentinel. If `TASK_COMPLETE` isn't emitted, the loop continues until `maxIterations` (default 20, see `index.ts`).
- **Turn timeout is 10 minutes** (`TURN_TIMEOUT_MS` in `process.ts`). Long-running agent calls past this will reject the turn.
- **Mentor reviews must include the structured JSON block** specified in the Mentor system prompt (`{"verdict":..., "risk":..., "nextStep":{...}}`). Don't strip or restructure that contract without updating the parser.
- **Output parsing is intentionally permissive** — it harvests text from many JSON event keys (`text`, `content`, `message`, `delta`, `parts`, `output_text`, `response`, `output`) because each provider CLI streams differently. When adding a new provider, verify which keys it emits rather than assuming.
- **Session continuity** uses each CLI's `--resume`/session-id mechanism (captured from stream output). Don't try to serialize agent state ourselves.

## Adding a provider

Edit `providers.ts`:
1. Add an entry to `PROVIDERS` with `cli`, `aliases`, version-check args
2. Implement argv construction in `buildCommand`
3. Add models to `MODEL_CATALOGS`
4. Add a default in `getDefaultModel`

The provider is auto-detected at startup by running its `--version` (or equivalent) — only installed CLIs appear in selection.

## Git assumption

`state.ts` runs `git status -s` via `execSync` to track modified files. The harness assumes the working directory is a git repo; there's no fallback path.
