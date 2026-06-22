# Pair Code

**Dual-agent AI coding harness for the terminal**

Two AI agents — a **Mentor** (planner/reviewer) and an **Executor** (coder) — collaborate on your task while you watch. Go grab a coffee, come back to reviewed code.

## Install

```bash
npm install -g pair-code
```

## How it works

Both roles are driven in-process through the [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript). Each role binds to an **Anthropic-compatible endpoint** (base URL + API key), so any provider exposing that protocol works:

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

Configure endpoints via environment variables:

```bash
PAIR_PROFILE_<NAME>_BASE_URL   # Anthropic-compatible endpoint
PAIR_PROFILE_<NAME>_KEY        # API key / bearer token
PAIR_PROFILE_<NAME>_MODEL      # default model id (optional)
```

…or use the standard `ANTHROPIC_API_KEY` (+ optional `ANTHROPIC_BASE_URL`). You can also enter an endpoint interactively at launch and optionally save it to disk (chmod 600).

## Usage

```bash
# Run in current directory
pair-code . "Fix the login bug in auth.ts"

# Run in a specific project
pair-code ~/projects/api "Add rate limiting middleware"

# List configured endpoint profiles
pair-code profiles
```

## Pair workflow

1. **Mentor** analyzes your task and creates an implementation plan
2. **Executor** implements the plan, making code changes
3. **Mentor** reviews the changes, checking for correctness and quality
4. They loop until the task is complete or the iteration budget is hit

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

## License

Apache-2.0
