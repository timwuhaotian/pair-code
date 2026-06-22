<p align="center">
  <img src="assets/icon.svg" width="128" height="128" alt="Pair Code icon" />
</p>

<h1 align="center">Pair Code</h1>

<p align="center">
  <strong>Dual-agent AI coding harness for the terminal</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/pair-code"><img src="https://img.shields.io/npm/v/pair-code?color=cb007d&label=npm" alt="npm version" /></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A520-339933" alt="node" />
  <img src="https://img.shields.io/github/license/timwuhaotian/pair-cli?color=blue" alt="license" />
  <a href="https://github.com/timwuhaotian/pair-cli/actions"><img src="https://img.shields.io/github/actions/workflow/status/timwuhaotian/pair-cli/release.yml?label=release" alt="release" /></a>
</p>

<p align="center">
  Two AI agents — a <strong>Mentor</strong> (planner/reviewer) and an <strong>Executor</strong> (coder) — collaborate on your task while you watch. Go grab a coffee, come back to reviewed code.
</p>

---

## Requirements

- **Node.js ≥ 20**
- **A git repository** — the harness tracks modified files via `git status`; there's no fallback.
- **An API key** for any Anthropic-compatible endpoint (see [Supported Providers](#supported-providers)).

## Install

```bash
npm install -g pair-code
```

## Quick Start

```bash
# Set your API key (any Anthropic-compatible provider)
export ANTHROPIC_API_KEY=sk-ant-...

# Run in the current directory
pair-code . "Fix the login bug in auth.ts"

# Run in a specific project
pair-code ~/projects/api "Add rate limiting middleware"

# List configured endpoint profiles
pair-code profiles
```

## How It Works

```
┌──────────────┐                      ┌──────────────┐
│   Mentor     │──── plan/review ────▶│   Executor   │
│  (read-only) │◀── changes/evidence ─│  (full tools) │
└──────────────┘                      └──────────────┘
       │                                      │
       └──────────── loop until ──────────────┘
              TASK_COMPLETE or max iterations
```

1. **Mentor** analyzes your task and creates an implementation plan.
2. **Executor** implements the plan, making real code changes with full tool access.
3. **Mentor** reviews the changes — it can read files but **cannot mutate anything** (enforced by the SDK: `allowedTools: ['Read','Grep','Glob']`, everything else disallowed).
4. They loop until the Mentor emits `TASK_COMPLETE`, or the iteration budget (default: unlimited, configurable) is hit.

Both roles are driven **in-process** through the [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript) — no shell-out to external CLIs. Each role can bind to a **different endpoint**, so you can mix providers (e.g. DeepSeek as Mentor, Kimi as Executor).

## Supported Providers

Any Anthropic-compatible endpoint works:

| Provider | Base URL | Notes |
|----------|----------|-------|
| Anthropic (official) | `https://api.anthropic.com` | Set `ANTHROPIC_API_KEY` |
| DeepSeek | `https://api.deepseek.com` | |
| GLM / Zhipu | `https://open.bigmodel.cn/api/paas/v4` | |
| Kimi (Moonshot) | `https://api.moonshot.cn/anthropic` | |
| Qwen (DashScope) | `https://dashscope.aliyuncs.com/api/v2` | |
| MiniMax | `https://api.minimaxi.com/anthropic` | |
| OpenRouter | `https://openrouter.ai/api/v1` | |
| LiteLLM gateway | your gateway URL | |
| Any Anthropic-compatible API | your URL | |

## Configuration

### Environment variables (preferred)

```bash
PAIR_PROFILE_<NAME>_BASE_URL   # Anthropic-compatible endpoint
PAIR_PROFILE_<NAME>_KEY        # API key / bearer token
PAIR_PROFILE_<NAME>_MODEL      # default model id (optional)
```

Plus the implicit official endpoint via `ANTHROPIC_API_KEY` (+ optional `ANTHROPIC_BASE_URL`).

### Interactive (session-only or saved)

You can enter an endpoint at launch via **"+ Add an endpoint…"** in any role picker:

- **"No — this session only"** — held in memory, never written to disk.
- **"Yes — save them"** — written to `~/.config/pair-code/config.json` with `0600` permissions inside a `0700` directory. The only place a key touches disk.

Manage saved credentials in-app with `/config`. Env vars always take precedence over a saved profile of the same name.

### Using different providers per role

Each role (Mentor, Executor) picks its own profile and model independently. For example:

```bash
export PAIR_PROFILE_DEEPSEEK_BASE_URL=https://api.deepseek.com
export PAIR_PROFILE_DEEPSEEK_KEY=sk-...
export PAIR_PROFILE_DEEPSEEK_MODEL=deepseek-chat

export PAIR_PROFILE_KIMI_BASE_URL=https://api.moonshot.cn/anthropic
export PAIR_PROFILE_KIMI_KEY=sk-...
export PAIR_PROFILE_KIMI_MODEL=moonshot-v1-128k
```

Then select DeepSeek for the Mentor and Kimi for the Executor in the setup wizard.

## Session Commands

| Command | Description |
|---------|-------------|
| `/task` | Start a new task with the current agents |
| `/resume` | Continue a paused session |
| `/config` | Configure endpoints, models & saved credentials |
| `/mentor` | Re-select mentor profile & model |
| `/runner` | Re-select executor profile & model |
| `/model` | Show current model configuration |
| `/status` | Show pair status & iteration info |
| `/files` | List modified files |
| `/diff` | Show git diff summary |
| `/profiles` | List configured endpoint profiles |
| `/clear` | Clear the screen |
| `/help` | Show available commands |
| `/quit` | Exit pair-code |

## Development

```bash
git clone https://github.com/timwuhaotian/pair-cli.git
cd pair-cli
npm install

npm run build       # tsup → dist/ (ESM, node20)
npm run dev         # tsup --watch
npm run typecheck   # tsc --noEmit
npm run lint        # eslint src
npm run start       # build then run dist/index.js

# Render the UX with sample data (no TTY/network needed)
npx tsx scripts/preview.tsx
```

**No test framework is configured.** To verify changes, run `npm run typecheck`, render `scripts/preview.tsx`, and exercise the CLI manually against a real endpoint.

### Project Structure

| Module | Responsibility |
|--------|---------------|
| `src/index.ts` | CLI entry; argv parsing, renders Ink `<App>`, `providers` subcommand |
| `src/process.ts` | Pair engine: `runTurn()` wraps one SDK `query()`; `runPairEngine()` runs the loop |
| `src/providers.ts` | Profile resolution (env + session + saved), model suggestions |
| `src/config.ts` | On-disk config I/O (atomic write, `0600`) |
| `src/state.ts` | `PairState` mutations (no rendering, no I/O beyond `git status`) |
| `src/types.ts` | Shared types and unions |
| `src/ui.ts` | Theme tokens (colors, icons, formatters) |
| `src/app.tsx` | Ink root: setup wizard, session view, slash-command dispatch |
| `src/components.tsx` | Presentational Ink components (Banner, StatusBar, AgentBar, etc.) |
| `src/inputs.tsx` | Interactive Ink inputs (Select, SearchSelect, TextPrompt, SlashInput) |
| `src/useEngine.ts` | Bridges engine callbacks to React state (live streaming) |

### Conventions

- **ESM only** — `"type": "module"`, no `require()`/CommonJS.
- **Strict TypeScript** — `strict: true`, type every signature.
- **Module boundaries** — no state mutation in components, no rendering in `state.ts`, no React in `process.ts`/`providers.ts`/`config.ts`.
- **Relative imports** use `.js` extensions even from `.ts`/`.tsx` sources.

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[Apache-2.0](LICENSE)

## Acknowledgements

- [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript) — in-process agent orchestration
- [Ink](https://github.com/vadimdemedes/ink) — React for CLIs
- [React 19](https://react.dev/) — UI runtime

## Releases

See the [releases page](https://github.com/timwuhaotian/pair-cli/releases) for changelogs and download artifacts.
