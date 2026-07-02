# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.1] - 2026-07-03

### Added
- `SECURITY.md` — security policy with private vulnerability reporting and a note on how credentials are handled.
- Dependabot config for weekly npm + GitHub Actions dependency updates.
- `.editorconfig` and `.nvmrc` (Node 20) for consistent contributor setup.
- `bugs` and `homepage` fields in `package.json`.
- `ErrorBoundary` in `index.ts` for graceful render-error recovery instead of hard crash.
- HTTP warning when using non-localhost `http://` endpoints (alerts user to key exposure).
- `getGitDiffStat()` async helper in `state.ts` for the `/diff` command.
- Config directory ownership verification (`statSync().uid === process.getuid()`).
- Config migration version stub for future schema changes.
- Concurrent-run guard in `useEngine` to prevent overlapping engine loops.

### Changed
- `LICENSE` now contains the full Apache-2.0 license text (previously the short notice only).
- Release workflow publishes with [npm provenance](https://docs.npmjs.com/generating-provenance-statements) and now wires up registry auth correctly.
- Standardized the default branch on `main`.
- Git operations in `state.ts` converted from blocking `execSync` to async `execFile` with 30s timeout.
- `getGitChanges()` returns immutable `{ files, gitStatus }` tuple instead of mutating state in place.
- `freshTask()` and `freshGreeting()` moved from `app.tsx` to `state.ts` (state construction out of UI layer).
- Mentor tool restriction now uses SDK `tools` option as primary enforcement; `Task`/`Skill` added to denylist.
- `EngineCallbacks` interface cleaned up — removed dead `onLog`/`onActivity`/`onError` callbacks.
- `useEngine` return value memoized with `useMemo`; `useEffect` dependencies corrected.
- `loadProfiles()` memoized in `SetupWizard` and `Session` — eliminates sync disk I/O on every render during streaming.
- Spinner components share a single ref-counted 80ms timer instead of independent intervals.
- Verdict JSON parsing uses brace-counting extractor (handles nested objects correctly).
- StatusBar responsive to terminal width — no overflow on 80-column terminals.
- Error messages truncated to 5 lines / 500 chars in `ResultPanel`.
- Transcript append optimized from O(n) `filter` to O(1) index-based slice.
- `warnIfNotGitRepo` converted from `spawnSync` to async `execFile`.
- Removed `LooseBlock`/`LooseStreamEvent` untyped escape hatches — uses SDK's own discriminated unions.
- Streaming text accumulation uses array `push` + `join` instead of string concatenation.
- Cursor glyph uses `icons.caret` for Windows compatibility (was hardcoded `▌`).
- `Message.to` narrowed from `string` to `MessageSender` union type.
- Profile names sanitized to `[a-zA-Z0-9_-]` characters.
- "Throttled — retrying" label changed to "Throttled — waiting" (no retry logic exists).
- `parseVerdict`/`stripVerdictBlocks` wrapped in `useMemo`.

### Fixed
- README quick-start used `pair-code profiles`; the subcommand is `pair-code providers`.
- ESLint custom rules now also apply to `.tsx` files (previously `.ts` only).
- Mentor could bypass read-only constraint via `Task`/`Skill` tools missing from denylist.
- Missing `allowDangerouslySkipPermissions: true` for Executor's `bypassPermissions` mode.
- Elapsed time showed `0s` when session paused or errored (`finishedAt` not set for non-finished states).
- `/resume` rejected error state — now allows retry from error.
- `/clear` permanently lost the banner (Ink `Static` key remount forces re-render).
- `/executor` success notice showed "runner" instead of "executor".
- `/diff` used `execSync` without `maxBuffer` — now async with 64 MiB buffer.
- Stale temp config files (containing API keys) accumulated on crash — now cleaned up before each write.
- Env-based profile base URLs not validated — now checked with `new URL()`.
- `makeCallbacks` missing from `useEffect` dependency array in `useEngine`.
- `killActiveTurn` imported directly in `app.tsx` — now uses `engine.requestStop()`.
- Type cast in `setState` replaced with type-safe discriminated branch.
- Empty slash command (`/`) showed "Unknown command: /" — now shows helpful hint.
- npm audit: js-yaml vulnerability fixed via `npm audit fix`.

## [0.2.0] - 2026-06-22

### Added
- Rebuilt engine on the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) — both agents are now driven through `query()`, which runs the agent runtime as a managed subprocess (the SDK pulls a platform-specific native binary and the agent inherits the process environment).
- Ink (React for CLIs) terminal UI with live streaming, agent bars, verdict chips, and slash commands.
- Per-role endpoint configuration: Mentor and Executor can use different Anthropic-compatible providers.
- Endpoint profiles via environment variables (`PAIR_PROFILE_<NAME>_BASE_URL` / `_KEY` / `_MODEL`).
- Interactive endpoint setup with session-only or saved-to-disk (chmod 600) credential storage.
- Curated model suggestions for DeepSeek, GLM/Zhipu, Kimi, Qwen, MiniMax, OpenRouter, and more.
- Slash commands: `/task`, `/resume`, `/config`, `/mentor`, `/runner`, `/model`, `/status`, `/files`, `/diff`, `/profiles`, `/clear`, `/help`, `/quit`.
- `providers` subcommand to list configured endpoint profiles.
- Unlimited iterations (configurable) with Mentor-emitted `TASK_COMPLETE` termination.
- 10-minute per-turn timeout with `AbortController`.
- Session continuity via per-turn `resume: <sessionId>`.
- GitHub Actions release workflow (auto-publish to npm on version change to `main`).
- Project icon, CONTRIBUTING.md, CODE_OF_CONDUCT.md, issue templates, PR template.

### Changed
- Repository URL corrected to `https://github.com/timwuhaotian/pair-code.git`.
- README rewritten with prerequisites, provider table, configuration docs, development setup, and project structure.
- Roles are now asymmetric and SDK-enforced: Mentor is read-only (`Read`, `Grep`, `Glob`), Executor has full tools.

### Removed
- Old CLI-shelling architecture (Claude Code / OpenCode / Codex / Gemini as external processes).
- `/log` and `/pause` slash commands (replaced by the new command set).

## [0.1.0] - 2026-05-25

### Added
- Initial release: interactive CLI components for selection, searching, and user input.
- Basic pair-programming harness with Mentor/Executor roles.
