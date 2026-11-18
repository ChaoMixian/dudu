# Running and deployment

[中文](../operations.md) · English

This document is for people who want to run, deploy, or extend dudu. See the [README](../../README.en.md) for the product introduction.

## Requirements

- Bun (runtime and build)
- Node.js (Vite build)
- Linux desktop capabilities (only needed for computer features):
  - Xvfb, xfce4-session, xfwm4, xfce4-panel, xfdesktop, xauth, xdpyinfo, xprop, xdotool, xclip, dbus-daemon, ffmpeg
  - [tembo/voxl](https://github.com/tembo/voxl): `cargo install voxl-server`; needs x264/libyuv/opus/libpulse/esbuild
  - Optional: xfce4-terminal, thunar

dudu never installs system packages and never modifies your default desktop session.

## Start

```sh
bun install --frozen-lockfile
bun run build
bun run start
```

Development mode (frontend watch + API on the same port):

```sh
bun run dev
```

Single-file build:

```sh
bun run build:binary
./release/dudu
```

Desktop sessions are managed directly by a supervisor inside the dudu process; no separate botd process is required.

The process that starts dudu must be able to find `voxl` on `PATH` (it is usually installed by `cargo install voxl-server` into `~/.cargo/bin`). For example:

```sh
PATH="$HOME/.cargo/bin:$PATH" bun run start
```

The single-file binary works the same way; it only removes the need for Node and `dist/`.

Default address: http://127.0.0.1:7331

Desktop sessions are owned by the dudu process and never expose a separate botd HTTP port. Production deployments should expose dudu through an HTTPS reverse proxy.

## Workspace

The default root is `~/Workspace`; override it with `DUDU_WORKSPACE`.

Workspace files are the source of truth:

```text
<workspace>/
├── .dudu/config.json          # global config, providers, default model
├── .dudu/state.sqlite         # inbox, sequence, run state, session paths
├── .dudu/botd/                # desktop state, private HOME, runtime data
├── connectors/<id>/connector.json
└── bots/<botId>/
    ├── bot.json
    ├── BOTS.md
    ├── MEMORY.md
    ├── work/                  # Bot working directory
    ├── home/                  # Bot private directory
    ├── sources/
    ├── artifacts/             # attachments, screenshots, etc.
    └── .pi/                   # Pi session
```

## Environment variables

| Variable | Description |
| --- | --- |
| `DUDU_WORKSPACE` | Workspace root |
| `DUDU_HOST` | API listen address, default `127.0.0.1` |
| `DUDU_PORT` | API port, default `7331` |
| `DUDU_BOTD_ROOT` | Desktop data directory, default `<workspace>/.dudu/botd` |
| `DUDU_TOKEN` | Bearer token; also accepted as the login password when no access password is set; can be set in `config.json` |
| `DUDU_URL` | dudu address used by the CLI |
| `UI_PREVIEW_PORT` | Isolated UI preview port |

Before exposing dudu to a LAN or the public internet, set an access password during first-run setup, or at least configure `DUDU_TOKEN`, and put dudu behind an HTTPS reverse proxy with access control.

## Model providers

You can configure providers in **Settings → Models**, or write `config.json` directly:

```json
{
  "host": "127.0.0.1",
  "port": 7331,
  "providers": [
    {
      "id": "local",
      "name": "Local",
      "baseUrl": "http://127.0.0.1:8000/v1",
      "api": "openai-completions",
      "apiKey": "sk-...",
      "models": [{ "id": "my-model", "name": "My model" }]
    }
  ],
  "defaultProvider": "local",
  "defaultModel": "my-model"
}
```

- `api` supports `openai-completions`, `openai-responses`, and `anthropic-messages`
- API keys are stored in plaintext in `.dudu/config.json`, with file mode `0600`
- The UI can fetch the model list from an upstream provider
- Bots do not require a bound model; without one they use the workspace default

## Bot message protocol

Every user-visible output from a Bot goes through `message_send`. `kind` supports:

- `message`: a normal message with optional quick-reply options
- `ask`: a question with vertical options and a free-text answer row
- `reaction`: an emoji attached to a specific message using `targetId`
- `takeover`: text plus a button that opens the computer takeover view

Attachments:

```json
{
  "attachments": [
    { "path": "report.pdf" },
    { "path": "/absolute/path/inside/bot/artifacts/chart.png", "name": "chart.png" }
  ]
}
```

- Paths are relative to the Bot's `work/`; absolute paths must stay inside the Bot workspace
- Up to 8 files, 50 MiB each
- Images, video, audio, PDF, and text are previewed inline; other types show a download card
- Files are copied into `artifacts/` and served through authenticated URLs

Bot-to-Bot protections:

- Bot events are coalesced in a one-second window; idle Bots receive them as one sequence-ordered batch
- Each Bot pair allows at most 20 automatic messages since the last human message
- After that limit, messages are still stored and shown in the thread. They no longer wake the peer immediately, but are included in its next digest
- `message_send` results and incoming Bot events include `remaining`; at 0, the Bot is told to stop and ask the human
- A human message to either Bot resets the budget for that pair

## Connectors and computers

Connectors are shared across the workspace. Every Bot can use them directly; no per-Bot binding is needed.

Bot desktops need no service URL. Each Bot gets its own desktop:

- A supervisor inside the dudu process starts Xvfb and the desktop session
- Agent computer tools are a built-in dudu capability that calls `Computer.cua()` directly; no connector, MCP subprocess, or HTTP hop
- **Settings → Connectors → Start desktops on launch** controls whether dudu restores all desktops at startup (on by default)
- Even with that setting off, the first computer tool call starts the Bot's stopped desktop
- Bots can also call `computer__status`, `computer__start`, and `computer__stop` directly
- dudu proxies voxl HTTP and WebSocket through `/api/bots/:botId/computer/live/`
- Browsers need **HTTPS or localhost** for WebCodecs to decode the computer stream

## Advanced mode

Enable it in **Settings → Advanced** to show an independent full-height tool panel beside the Bot conversation. Files / Terminal / Session / Computer open as browser-like tabs, the start page chooses a tool, and the left edge resizes the panel; dragging it narrow closes the panel but keeps the tabs. The button at the left of the tab bar searches, switches, and closes tabs, and overflowing tabs fade at the edge. The left sidebar can also be dragged narrow to collapse into the icon rail. When off, these entries and the panel are hidden; composer upload, drag-and-drop, and paste remain available.

- **Files**: only the Bot workspace `work/`, `artifacts/`, `BOTS.md`, and `MEMORY.md` are exposed. Absolute paths, `..`, and symlinks are rejected. Up to 8 files per upload, 50 MiB each.
- **Terminal**: runs bash in a PTY inside the Bot desktop environment (falling back to `/bin/sh` when bash is absent), with cwd `work/`. Closing the panel or switching Bots only drops the connection; the PTY keeps running and reconnects when reopened. Closing the terminal tab or stopping the desktop ends it. The PTY size follows the panel width.
- **Session**: reads `.pi/session.jsonl` in 256 KiB windows, loads older entries on upward scroll, and streams live events over SSE. Tool output and base64 images are bounded or summarized.
- **Computer**: view and operate the current Bot desktop directly.
- Advanced mode is UI containment, not privilege separation; files, the terminal, and the desktop still run as the user running dudu.

## Release

Versions use `0.1.x`; bump the last component for each release (for example `0.1.0` → `0.1.1`). Releases are triggered by a Git tag, and the tag must exactly match `package.json` `version`:

```sh
# 1. Bump package.json version and commit it
# 2. Create a signed tag
git tag -s v0.1.0 -m "dudu 0.1.0"
# 3. Push the commit and tag
git push origin main
git push origin v0.1.0
```

`.github/workflows/ci.yml` runs typecheck, tests, the frontend build, and the single-file build on `main` and pull requests. Pushing a `v*` tag runs `.github/workflows/release.yml`, which re-validates the version, runs the tests, builds the `linux-x64` single file on Ubuntu 22.04 to keep a lower glibc baseline, creates `dudu-<version>-linux-x64.tar.gz` plus a SHA-256 checksum, and publishes a GitHub Release.

## Remote access

- Prefer an HTTPS reverse proxy for dudu. If using frp, forward both HTTP and WebSocket and keep them same-origin
- iOS home-screen apps and Service Workers require HTTPS (or localhost on the device); plain HTTP over a LAN IP only works as a basic web clip, with unreliable icons, standalone behavior, and safe areas
- The computer stream already uses dudu's own port; no extra voxl port needs to be exposed
- Self-signed certificates must be trusted by the browser; otherwise some capabilities (such as WebCodecs) may not work

## CLI

```sh
bun src/cli.ts bots list
bun src/cli.ts bots new '{"name":"Alice"}'
bun src/cli.ts send alice 'Hello, reply through message_send.'
bun src/cli.ts events list
bun src/cli.ts events register '{"id":"wake-alice","botId":"alice","kind":"interval","enabled":true,"priority":"low","payload":{"task":"check the task"},"intervalMs":60000}'
bun src/cli.ts events trigger wake-alice
bun src/cli.ts events disable wake-alice
```

`DUDU_URL` sets the server address; `DUDU_TOKEN` sets the Bearer token.

## Verification

```sh
bun test
bun run typecheck
bun run build
```

End-to-end check without a real provider:

```sh
bun examples/fixtures/model-fixture.ts 7340 &
# In Settings → Models, add:
# baseUrl http://127.0.0.1:7340/v1
# api openai-completions
# API key fixture-key
# model fixture-model
```

More internals:

- [Architecture](architecture.md)
- [Connectors and event protocol](connectors.md)
