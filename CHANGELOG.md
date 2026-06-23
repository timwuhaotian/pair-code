# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `SECURITY.md` — security policy with private vulnerability reporting and a note on how credentials are handled.
- Dependabot config for weekly npm + GitHub Actions dependency updates.
- `.editorconfig` and `.nvmrc` (Node 20) for consistent contributor setup.
- `bugs` and `homepage` fields in `package.json`.

### Changed
- `LICENSE` now contains the full Apache-2.0 license text (previously the short notice only).
- Release workflow publishes with [npm provenance](https://docs.npmjs.com/generating-provenance-statements) and now wires up registry auth correctly.
- Standardized the default branch on `main`.

### Fixed
- README quick-start used `pair-code profiles`; the subcommand is `pair-code providers`.
- ESLint custom rules now also apply to `.tsx` files (previously `.ts` only).

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
