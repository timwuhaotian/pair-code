# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`pair-code` is a CLI harness that orchestrates two AI coding agents in a loop: a **Mentor** (plans, reviews) and an **Executor** (writes code). It drives both agents through the **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) in-process — it spawns one `query()` per turn rather than shelling out to installed agent CLIs. Each role binds to an **Anthropic-compatible endpoint** (base URL + key) declared in the environment, so any provider exposing that protocol (DeepSeek, GLM/Zhipu, Kimi, Qwen, MiniMax, OpenRouter, a LiteLLM gateway, or the official Anthropic API) can drive either role.

The terminal UI is built with **Ink** (React for CLIs).

## Commands

```bash
npm run build      # tsup → dist/ (ESM, node20 target, JSX via tsconfig, #!/usr/bin/env node banner)
npm run dev        # tsup --watch
npm run start      # build then run dist/index.js
npm run lint       # eslint src
npm run typecheck  # tsc --noEmit
npx tsx scripts/preview.tsx   # render the UX frames with sample data (no TTY/network) — use to iterate on the UI
```

- Focused CLI tests use Node's built-in test runner directly: `node --import tsx --test tests/*.test.tsx`. Don't run `npm test` unless a script is added. To verify broader changes, run `npm run typecheck`, render `scripts/preview.tsx`, and exercise the CLI manually against a real Anthropic-compatible endpoint.
- **No formatter is configured.** Match surrounding style; don't add a formatter without asking.
- Node `>=20.0.0` required.

## Endpoint profiles (auth)

Secrets come from one of three sources. The first two are equally ephemeral (process memory); the third persists **only with explicit opt-in**:

1. **Environment** (preferred for repeat use):
   ```bash
   PAIR_PROFILE_<NAME>_BASE_URL   # Anthropic-compatible endpoint
   PAIR_PROFILE_<NAME>_KEY        # API key / bearer token (required)
   PAIR_PROFILE_<NAME>_MODEL      # default model id (optional)
   ```
   …plus the implicit official endpoint via the standard `ANTHROPIC_API_KEY` (+ optional `ANTHROPIC_BASE_URL`).
2. **Interactively, session-only**: if no profiles are configured (or via "+ Add an endpoint…" in any role picker), the user types a base URL + key, then chooses **"No — this session only"**. `registerSessionProfile()` holds it in an in-memory `Map` for the session — never written to disk. The profile name is auto-derived from the URL host (so `api.deepseek.com` → `deepseek`, which also makes it match curated model suggestions).
3. **Interactively, saved** (opt-in): same flow, but the user chooses **"Yes — save them"**. `persistProfile()` writes the endpoint + model + key to `config.json` under the user's config dir (`$XDG_CONFIG_HOME/pair-code` or `~/.config/pair-code`), with the file at `0600` inside a `0700` dir — the only place a key touches disk. `/config → Manage saved credentials` deletes them. Re-saving the same endpoint overwrites in place (key rotation).

A profile is "ready" only when its key is present, so the picker can only ever offer endpoints that can actually run. `loadProfiles()` merges env + session + saved profiles (secrets stripped); `resolveProfile()` returns the secret (session store → env → saved config, so an env key always shadows a saved one of the same name). At turn time `providers.ts` builds a per-call `env` overlay (`ANTHROPIC_BASE_URL` + `ANTHROPIC_API_KEY` + `ANTHROPIC_AUTH_TOKEN`); because the loop is strictly sequential, two roles on different endpoints never collide.

## Module layout (`src/`)

Keep these boundaries — they're load-bearing:

- `index.ts` — CLI entry; parses argv and renders the Ink `<App>` (also the `providers` subcommand + `--help`/`--version`)
- `process.ts` — pair engine: `runTurn()` wraps one SDK `query()`; `runPairEngine()` runs the mentor→executor→mentor loop
- `providers.ts` — profile resolution across env + session + saved (`loadProfiles`/`resolveProfile`/`profileEnv`/`addEndpoint`/`persistProfile`/`forgetProfile`) + model suggestions
- `config.ts` — the on-disk config: `readConfig`/`writeConfig`/`configPath` (atomic write, `0600`). Pure I/O — no profile/merge logic (that's `providers.ts`), no React
- `state.ts` — `PairState` mutations only (no rendering, no I/O beyond `git status`)
- `types.ts` — shared types and unions (`Profile`, `AgentRuntime`, `ToolEvent`, `PairStatus`, …). No CLI `ProviderKind`.
- `ui.ts` — theme tokens (colour hexes, icons, formatters). No rendering, no state.
- `app.tsx` — Ink root: setup wizard (spec → per-role profile/model), session view, slash-command dispatch
- `components.tsx` — presentational Ink components (Banner, StatusBar, AgentBar, MessageView, LiveTurn, ResultPanel, verdict chip)
- `inputs.tsx` — interactive Ink inputs (`Select`, `SearchSelect`, `TextPrompt`, `SlashInput`) + fuzzy match
- `useEngine.ts` — bridges the engine's imperative callbacks to React state (live streaming buffers, throttled)

Don't mix concerns: no state mutation in components, no rendering in `state.ts`, no React in `process.ts`/`providers.ts`/`state.ts`/`config.ts`.

## TypeScript / module conventions

- `"type": "module"` + `moduleResolution: "bundler"`. Relative imports use `.js` extensions even from `.ts`/`.tsx` sources.
- `strict: true`. Type every signature; prefer discriminated unions over `any`.
- JSX: `react-jsx` (automatic runtime) via tsconfig; React 19 + Ink 7. In `.tsx`, import the `JSX` type explicitly (`import type { JSX } from 'react'`) — React 19 moved it off the global namespace.
- ESM only — no `require()`/CommonJS.

## Pair-engine invariants

Breaking any of these will silently corrupt the loop:

- **Only the Mentor may emit `TASK_COMPLETE`**, on its own line. The Executor's system-prompt append forbids it. Without it the loop runs until `maxIterations` (default: unlimited / `Infinity` — a finite cap can be passed explicitly) or the user stops it.
- **Roles are asymmetric and enforced via the SDK.** Executor: `permissionMode: 'bypassPermissions'`, full tools. Mentor: read-only — `allowedTools: ['Read','Grep','Glob']` + everything else `disallowedTools`. The mentor inspects to verify but can never mutate. The Executor attaches its own build/test output as evidence because the mentor cannot run commands.
- **Turn timeout is 10 minutes** (`TURN_TIMEOUT_MS`); on timeout the turn's `AbortController` aborts and the active `query` is interrupted.
- **Mentor reviews must include the structured JSON block** (`{"verdict":…, "risk":…, "nextStep":{…}}`). `components.tsx` parses it into a verdict chip; don't change the contract without updating `parseVerdict`.
- **Streaming**: `includePartialMessages: true` yields `stream_event` text deltas (live text) and `assistant` messages carry `tool_use` blocks (the tool timeline); the final `result` message carries the canonical output + `session_id` + usage. Read `result.result` — don't re-harvest text from intermediate events.
- **Session continuity** is per-turn: each turn starts a fresh `query()` with `resume: <sessionId>` captured from the prior turn's `system/init` or `result` message.

## Adding an endpoint

Nothing to edit — declare `PAIR_PROFILE_<NAME>_BASE_URL` + `_KEY` (+ optional `_MODEL`) in the environment and it appears in the picker. Or add one at runtime via "+ Add an endpoint…" / `/config` and optionally save it to disk. To add curated model suggestions for a brand, extend `SUGGESTIONS` in `providers.ts` (users can always type a custom model id).

## Git assumption

`state.ts` runs `git` via `execSync` to track modified files. The harness assumes a git repo; there's no fallback path.
