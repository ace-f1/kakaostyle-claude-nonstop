# kakaostyle-claude-nonstop

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-green.svg)](https://nodejs.org/)

KakaoStyle fork of `claude-nonstop` with priority-aware multi-account switching, failback, and Slack remote access for Claude Code.

**Failover:** When you hit a rate limit mid-session, the runner migrates your session to a different account and resumes automatically.

**Optional failback:** When enabled, the runner polls usage in the background and returns to a recovered higher-priority account once the session is idle.

**Slack remote access:** Each Claude Code session gets a dedicated Slack channel. Send messages in the channel to control Claude remotely. Claude's responses are posted back to the channel.

![claude-nonstop: Slack remote access and multi-account switching](assets/screenshot.png)

> **Platform:** Tested on macOS only. Linux may work but is untested.

[Contributing](CONTRIBUTING.md) | [Security Policy](SECURITY.md) | [Architecture](DESIGN.md)

## Usage

```bash
kakaostyle-claude-nonstop                       # Run Claude (best account, auto-switching)
kakaostyle-claude-nonstop -p "fix the bug"      # One-shot prompt
kakaostyle-claude-nonstop status                # Show usage across all accounts
kakaostyle-claude-nonstop --remote-access       # Run with tmux + Slack channels
```

Sample `status` output:

```
  default (alice@gmail.com)
    5-hour:  ███░░░░░░░░░░░░░░░░░ 14%
    7-day:   ██████░░░░░░░░░░░░░░ 29%

  work (alice@company.com) <-- best
    5-hour:  █░░░░░░░░░░░░░░░░░░░ 3%
    7-day:   ██░░░░░░░░░░░░░░░░░░ 8%
```

On launch, the runner checks usage across all accounts and picks the best one. If you hit a rate limit mid-session, it switches to the next best account and resumes your conversation. Priority-based failback is available as an explicit option.

## Priority-Based Failback

This scenario is disabled by default. Enable it explicitly with `--auto-failback`.

Assign lower numbers to more preferred accounts:

```bash
kakaostyle-claude-nonstop set-priority work 1
kakaostyle-claude-nonstop set-priority personal 2
```

With that setup:

- `work` stays primary whenever it is under the near-exhausted threshold.
- If `work` hits a limit, the session fails over to `personal`.
- While running on `personal`, the runner polls usage every minute.
- As soon as `work` recovers and the active Claude session has been quiet for 5 seconds, the runner migrates the session back to `work`.

Run it like this:

```bash
kakaostyle-claude-nonstop --auto-failback
```

### Example: Company `Pro` + Personal `Max`

Typical KakaoStyle-style setup:

```bash
kakaostyle-claude-nonstop add work
kakaostyle-claude-nonstop add personal
kakaostyle-claude-nonstop set-priority work 1
kakaostyle-claude-nonstop set-priority personal 2
```

Expected runtime behavior:

- Start on `work` when the company `Pro` account still has headroom.
- If `work` hits a rate limit, fail over to `personal` and resume the same session.
- Keep running on `personal` while the company `Pro` limit window resets.
- Once `work` is healthy again, automatically fail back from `personal` to `work`.
- Do not consume extra swap budget for the failback hop.

CLI options:

- `--auto-failback`: enable proactive failback
- `--no-auto-failback`: force failback off
- `--failback-poll-ms <n>`: polling interval
- `--failback-idle-ms <n>`: quiet window before failback
- `--failback-cooldown-ms <n>`: cooldown after a switch

Environment variables:

- `CLAUDE_NONSTOP_AUTO_FAILBACK=1`: enable proactive failback by default
- `CLAUDE_NONSTOP_FAILBACK_POLL_MS`: poll interval for recovery checks
- `CLAUDE_NONSTOP_FAILBACK_IDLE_MS`: required idle window before failback
- `CLAUDE_NONSTOP_FAILBACK_COOLDOWN_MS`: minimum time after a switch before failback
- `CLAUDE_NONSTOP_DISABLE_FAILBACK=1`: disable proactive failback

### Manual Verification

Recommended manual test flow:

1. Register two accounts and set priority:
   `work=1`, `personal=2`
2. Shorten timing so failback is easy to observe:

```bash
kakaostyle-claude-nonstop \
  --auto-failback \
  --failback-poll-ms 5000 \
  --failback-idle-ms 2000 \
  --failback-cooldown-ms 5000
```

3. Trigger or wait for a `work -> personal` failover.
4. Confirm the session resumes on `personal` with the same `--resume` session.
5. Wait until `work` usage recovers.
6. Confirm the runner logs a failback and migrates the session back to `work`.

Expected log shape:

- `Selected "work" (...)`
- `Rate limit detected on "work" (...)`
- `Switching to "personal" (...)`
- `Session <id> migrated successfully`
- `Higher-priority account recovered while "personal" was active. Failing back...`
- `Failing back to "work" (...)`
- `Session <id> migrated successfully`

## Commands

**Core:**

| Command | Description |
|---------|-------------|
| `status` | Show usage with progress bars and reset times |
| `add <name>` | Add a new Claude account (opens browser for OAuth) |
| `remove <name>` | Remove an account |
| `list` | List accounts with auth status |
| `reauth` | Re-authenticate expired accounts |
| `resume [id]` | Resume most recent session, or a specific one by ID |

**Slack remote access:**

| Command | Description |
|---------|-------------|
| `setup` | Configure Slack tokens + install hooks (run `setup --help` for flags) |
| `webhook status` | Show webhook service status |
| `webhook install` | Install webhook as launchd service (macOS) |
| `webhook logs` | Tail the webhook log |
| `hooks install` | Install hooks into all profiles |
| `hooks status` | Show hook installation status |

**Maintenance:**

| Command | Description |
|---------|-------------|
| `update` | Reinstall from local source |
| `uninstall` | Remove `kakaostyle-claude-nonstop` completely |

Any unrecognized arguments are passed through to `claude` directly. Use `-a <name>` to select a specific account.

## Install

The easiest way to install is to ask Claude Code:

```
You: set up kakaostyle-claude-nonstop for me
```

Claude Code will follow the setup instructions in [CLAUDE.md](CLAUDE.md) to install, configure accounts, and set up Slack remote access interactively. That file also serves as a reference for AI agents automating the setup.

### Manual install

**Prerequisites:** Node.js 22+ ([download](https://nodejs.org/)), C/C++ build tools (`xcode-select --install` on macOS), Claude Code CLI ([install](https://docs.anthropic.com/en/docs/claude-code/overview)), and tmux for remote access.

```bash
git clone https://github.com/ace-f1/kakaostyle-claude-nonstop.git
cd kakaostyle-claude-nonstop
npm install -g "$(npm pack)"
kakaostyle-claude-nonstop help
```

If `npm install -g` fails with compilation errors, you're missing C/C++ build tools.

## Multi-Account Setup

Your existing `~/.claude` account is auto-detected as "default". Verify with `kakaostyle-claude-nonstop list`.

Add additional accounts (each must be a different Claude subscription). Names can contain letters, numbers, hyphens, and underscores:

```bash
kakaostyle-claude-nonstop add work
kakaostyle-claude-nonstop add personal
```

Each `add` opens your browser for OAuth. After login, `kakaostyle-claude-nonstop` checks for duplicate accounts (same email) and removes them automatically.

Verify all accounts are working:

```bash
kakaostyle-claude-nonstop status
```

Then just run `kakaostyle-claude-nonstop` — rate limit switching is automatic.

**Troubleshooting:**
- OAuth didn't complete? Run `kakaostyle-claude-nonstop reauth`
- Status shows `error (HTTP 401)`? Run `kakaostyle-claude-nonstop reauth`
- "No credentials found"? Run `CLAUDE_CONFIG_DIR="$HOME/.claude-nonstop/profiles/<name>" claude auth login`

**Optional aliases** (`~/.zshrc` or `~/.bashrc`):

```bash
alias claude='kakaostyle-claude-nonstop'
alias cn='kakaostyle-claude-nonstop --dangerously-skip-permissions'
```

## Slack Remote Access

### 1. Create a Slack App

Go to [api.slack.com/apps](https://api.slack.com/apps) > **Create New App** > **From a manifest**. Paste [`slack-manifest.yaml`](slack-manifest.yaml), click **Create**, then **Install to Workspace**.

<details>
<summary>Manual setup (without manifest)</summary>

Create a new app at [api.slack.com/apps](https://api.slack.com/apps). Enable Socket Mode (Settings > Socket Mode). Add bot token scopes: `chat:write`, `channels:manage`, `channels:history`, `channels:read`, `reactions:read`, `reactions:write`, `app_mentions:read`, `im:history`, `im:read`, `im:write`. Subscribe to bot events: `message.channels`, `message.im`, `app_mention`. Install to workspace.
</details>

**Collect two tokens:**

1. **Bot Token** (`xoxb-...`) — OAuth & Permissions page (created on install)
2. **App Token** (`xapp-...`) — Basic Information > App-Level Tokens > **Generate Token and Scopes** > add `connections:write` scope > Generate

### 2. Run setup

```bash
kakaostyle-claude-nonstop setup --bot-token xoxb-... --app-token xapp-... --invite-user-id U12345ABCDE
```

This writes `~/.claude-nonstop/.env`, installs hooks, and starts the webhook service (macOS). Run `setup --help` for all flags. For interactive setup, just run `kakaostyle-claude-nonstop setup`.

Find your Slack User ID: click your profile picture > Profile > three-dot menu > Copy member ID.

### 3. Verify

```bash
kakaostyle-claude-nonstop webhook status    # Should show "running" with a PID
kakaostyle-claude-nonstop hooks status      # All should show "installed"
```

### 4. Run with remote access

```bash
kakaostyle-claude-nonstop --remote-access
```

This creates a tmux session named after the current directory, enables `--dangerously-skip-permissions` for unattended operation, and sets `CLAUDE_REMOTE_ACCESS=true` so each session gets a dedicated Slack channel (e.g., `#cn-myproject-abc12345`). Reply in the channel to send messages to Claude.

**Control commands** in session channels:

| Command | Action |
|---------|--------|
| `!stop` | Interrupt Claude (Ctrl+C) |
| `!status` | Show current terminal output |
| `!cmd <text>` | Relay text verbatim (e.g. `!cmd /clear`) |
| `!help` | List available commands |
| `!archive` | Archive the channel |

**Note:** Slack message relay sends keystrokes to tmux. Claude must be waiting for input to receive messages. If Claude is mid-processing, keystrokes queue and are delivered when Claude next waits.

**Security:** `--remote-access` implies `--dangerously-skip-permissions`, giving Claude full system access. Use `SLACK_ALLOWED_USERS` to restrict who can send commands via Slack.

**Troubleshooting:**
- Channel not created? Run `kakaostyle-claude-nonstop hooks install` then `hooks status`
- Webhook not receiving? Run `kakaostyle-claude-nonstop webhook status` then `webhook logs`
- Messages not reaching Claude? Check `tmux ls` and that Claude is waiting for input

## How It Works

**Multi-account switching** queries the Anthropic usage API for all accounts (~200ms), picks the one with the most headroom, then monitors Claude's output for rate limit messages in real-time. On detection: kill, migrate session files to the next account, resume with `claude --resume`.

**Slack remote access** uses Claude Code [hooks](https://docs.anthropic.com/en/docs/claude-code/hooks) — `SessionStart` creates a Slack channel, `Stop` posts a completion summary. A separate webhook process connects via Slack Socket Mode and relays channel messages to tmux. The runner scrapes PTY output for tool activity and posts progress updates to Slack every ~10 seconds.

## Architecture

```
kakaostyle-claude-nonstop/
├── bin/claude-nonstop.js         CLI entry point and command routing
├── lib/                          Core logic (ESM)
│   ├── config.js                 Account registry
│   ├── keychain.js               OS credential store reading
│   ├── usage.js                  Anthropic usage API client
│   ├── scorer.js                 Best-account selection
│   ├── session.js                Session file migration
│   ├── runner.js                 Process wrapper + rate limit detection
│   ├── service.js                launchd service management (macOS)
│   ├── tmux.js                   tmux session management
│   ├── reauth.js                 Re-authentication flow
│   └── platform.js               OS detection
├── remote/                       Slack remote access subsystem (CJS)
│   ├── hook-notify.cjs           Hook entry point
│   ├── channel-manager.cjs       Slack channel lifecycle
│   ├── webhook.cjs               Socket Mode handler (Slack -> tmux)
│   ├── start-webhook.cjs         Webhook process entry point
│   ├── load-env.cjs              Environment file loader
│   └── paths.cjs                 Shared path constants
└── scripts/postinstall.js        Restart webhook on npm install
```

User data lives under `~/.claude-nonstop/` (config, `.env`, profiles, logs). See [DESIGN.md](DESIGN.md) for details.

## Troubleshooting

### `npm install` fails with compilation errors

`node-pty` requires C/C++ build tools: `xcode-select --install` (macOS), then re-run `npm install`.

### Usage shows "error (HTTP 401)"

OAuth token expired. Run `kakaostyle-claude-nonstop reauth` to refresh all expired accounts.

### Webhook not receiving messages

Check `kakaostyle-claude-nonstop webhook status` and `webhook logs`. Verify Socket Mode is enabled and bot events (`message.channels`, `message.im`) are subscribed in your Slack app settings.

### Messages not reaching Claude

Claude must be waiting for input. Check `tmux ls` and `~/.claude-nonstop/data/channel-map.json`.

## Platform Support

| Platform | Credential Store | Service Management | Status |
|----------|-----------------|-------------------|--------|
| macOS | Keychain (`security`) | launchd | Tested |
| Linux | Secret Service (`secret-tool`) | Manual (systemd) | Untested |
| Windows | — | — | Not supported |

## License

[MIT](LICENSE)
