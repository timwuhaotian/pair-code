# Security Policy

## Supported versions

`pair-code` is pre-1.0 and ships from a single line of development. Security
fixes are applied to the latest published release on npm and the `main` branch.
Please make sure you are on the latest version before reporting an issue.

| Version | Supported |
| ------- | --------- |
| Latest `0.x` | ✅ |
| Older `0.x` | ❌ |

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Report privately through either channel:

- **GitHub** — open a [private security advisory](https://github.com/timwuhaotian/pair-cli/security/advisories/new)
  (Security → Advisories → "Report a vulnerability").
- **Email** — gosingk@gmail.com.

Please include a description of the issue, reproduction steps, the version
affected, and the potential impact. You can expect an initial acknowledgement
within a few days. Once a fix is available we will coordinate a release and
credit you in the changelog unless you prefer to remain anonymous.

## The Executor is unsandboxed

The **Executor is an unsandboxed coding agent**, and this is a real trust
boundary you should understand before running `pair-code`:

- It runs with full tools and `bypassPermissions`, so it can **execute
  arbitrary shell commands, read and write files, and make network requests**
  on your behalf — by design, so it can actually implement and verify changes.
- Its subprocess **inherits the entire ambient process environment**. Any
  secret you have exported in your shell (cloud credentials, tokens, other API
  keys) is therefore reachable by the agent.
- Because either role can be pointed at an arbitrary, possibly third-party,
  Anthropic-compatible endpoint, anything the Executor reads — including those
  inherited secrets — **could be sent to that endpoint**.

To contain this, run `pair-code` in a **clean environment, container, or
dedicated working directory** with only a **dedicated API key** exported, rather
than from a shell that holds unrelated secrets. Pointing a role at the official
Anthropic endpoint (base URL `https://api.anthropic.com`) pins
`ANTHROPIC_BASE_URL` to that host for the call, so an ambient `ANTHROPIC_BASE_URL`
won't silently redirect the key elsewhere.

## Handling of credentials

`pair-code` connects to Anthropic-compatible endpoints using API keys you
provide. It is worth understanding how those secrets are handled:

- **Environment variables** (`PAIR_PROFILE_<NAME>_KEY`, `ANTHROPIC_API_KEY`)
  and **session-only profiles** entered interactively live in process memory
  only — they are never written to disk.
- **Saved profiles** are written **only when you explicitly opt in** ("Yes —
  save them"). They are stored in `config.json` under your config directory
  (`$XDG_CONFIG_HOME/pair-code` or `~/.config/pair-code`) with `0600`
  permissions inside a `0700` directory — the only place a key touches disk.
- Keys are **never** logged, printed, or included in error output, and the
  profile listings always strip secrets.

If you discover a path where a credential leaks to disk, logs, or the terminal
outside of the opt-in saved-config file, please treat it as a vulnerability and
report it privately as described above.
