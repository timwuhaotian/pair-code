# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-06-22

### Added
- Rebuilt engine on the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) — both agents now run in-process via `query()`, no shell-out to external CLIs.
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
- Repository URL corrected to `https://github.com/timwuhaotian/pair-cli.git`.
- README rewritten with prerequisites, provider table, configuration docs, development setup, and project structure.
- Roles are now asymmetric and SDK-enforced: Mentor is read-only (`Read`, `Grep`, `Glob`), Executor has full tools.

### Removed
- Old CLI-shelling architecture (Claude Code / OpenCode / Codex / Gemini as external processes).
- `/log` and `/pause` slash commands (replaced by the new command set).

## [0.1.0] - 2026-05-25

### Added
- Initial release: interactive CLI components for selection, searching, and user input.
- Basic pair-programming harness with Mentor/Executor roles.
