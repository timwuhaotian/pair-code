# Pair Code

**Dual-agent AI coding harness for the terminal**

Two AI agents — a **Mentor** (planner/reviewer) and an **Executor** (coder) — collaborate on your task while you watch. Go grab a coffee, come back to reviewed code.

## Install

```bash
npm install -g pair-code
```

## Usage

```bash
# Run in current directory
pair-code . "Fix the login bug in auth.ts"

# Run in a specific project
pair-code ~/projects/api "Add rate limiting middleware"

# Check which AI providers are installed
pair-code providers
```

## How it works

1. **Mentor** analyzes your task and creates an implementation plan
2. **Executor** implements the plan, making code changes
3. **Mentor** reviews the changes, checking for correctness and quality
4. They loop until the task is complete or the iteration budget is hit

## Supported Providers

| Provider | CLI | Install |
|----------|-----|---------|
| Claude Code | `claude` | `npm i -g @anthropic-ai/claude-code` |
| OpenCode | `opencode` | `go install github.com/opencode-ai/opencode@latest` |
| Codex | `codex` | `npm i -g @openai/codex` |
| Gemini | `gemini` | Install via Google |

## Session Commands

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/status` | Show pair status |
| `/files` | List modified files |
| `/log` | Show full message history |
| `/pause` | Pause the session |
| `/quit` | Exit pair-code |

## License

Apache-2.0
