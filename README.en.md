<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/brand/png/dudu-logo-horizontal-dark-1024.png">
  <img src="docs/brand/png/dudu-logo-horizontal-1024.png" alt="dudu" width="240">
</picture>

[中文](README.md) · English

![status](https://img.shields.io/badge/status-alpha-orange)
![TypeScript](https://img.shields.io/badge/TypeScript-7.x-3178C6?logo=typescript&logoColor=white)
![Bun](https://img.shields.io/badge/Bun-runtime-f9f1e1?logo=bun&logoColor=000)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=000)

**dudu is a local-first runtime for Bots. Every Bot has a persistent identity, its own memory and workspace, and its own Linux desktop.**

dudu treats Bots as long-lived collaborators rather than one-off chat windows. A Bot can keep handling messages, scheduled work, and external events while you are away. It can start conversations, send files, collaborate with other Bots, or ask you to take over its computer.

![dudu](docs/assets/dudu-chat.en.png)

## Features

- **Long-lived** — Bots keep their own memory, files, and sessions; they keep handling messages, scheduled tasks, and external events after you close the page.
- **A real computer** — each Bot has its own Linux desktop for browsers, terminals, and desktop apps.
- **Proactive** — Bots can start conversations, ask questions, send files, and request computer takeover.
- **Collaboration** — Bots message each other, split work, and hand off tasks, with a full history.
- **Local first** — configuration, memory, files, and sessions stay in a workspace on your machine.

Full Bot-to-Bot history:

![Bot conversation](docs/assets/dudu-bot-thread.en.png)

## Quick start

### Requirements

- [Bun](https://bun.sh/)
- Node.js 20.19+ or 22.12+ (required by Vite 8)
- For computer features: Linux X11 dependencies and [voxl](https://github.com/tembo/voxl) on `PATH`; see [operations](docs/en/operations.md)

### Install and run

```sh
bun install
bun run build
bun run start
```

Open http://127.0.0.1:7331. dudu manages Bot desktops itself, so no separate service is needed. For computer features, make sure `voxl` is on `PATH` (for example, `PATH="$HOME/.cargo/bin:$PATH" bun run start`).

Single-file distribution:

```sh
bun run build:binary
./release/dudu
```

`release/dudu` embeds the frontend and runs as a single file.

### First run

The first visit opens the setup guide. Use **New Bot** to add more Bots later.

### Advanced mode

Enable it in **Settings → Advanced** to show a tool panel beside the Bot conversation; files, Terminal, Session, and Computer open there in tabs.

- **Files** — browse and manage files in the Bot workspace.
- **Terminal** — open a terminal in the Bot desktop; it keeps running after you close the page.
- **Session** — inspect the live session, tool calls, and results.
- **Computer** — view and operate the current Bot desktop.

When advanced mode is off, these entries stay hidden; normal chat still supports attachments.

## How it works

```text
Browser (React)
      │ HTTP / SSE
      ▼
dudu server (Bun)
      ├── Store (SQLite: events / messages / bot_messages)
      ├── Scheduler ──► Pi AgentSession
      ├── Connector registry
      └── Computer / BotdSupervisor ──► Linux desktop
```

- `Store` owns the event inbox, chat timeline, Bot-to-Bot history, and run state.
- `Scheduler` delivers events to Agents in order, handles idle wakeups, and batches backlogs.
- Each Bot's Agent runs in its own Pi session.
- Desktop sessions are managed by a supervisor inside the dudu process; the live view is still proxied through the same origin.

See the [architecture document](docs/en/architecture.md) for details.

## Configuration

Common environment variables:

| Variable | Default | Description |
| --- | --- | --- |
| `DUDU_WORKSPACE` | `~/Workspace` | Workspace root |
| `DUDU_HOST` | `127.0.0.1` | API listen address |
| `DUDU_PORT` | `7331` | API port |
| `DUDU_TOKEN` | empty | Bearer token; enables authentication |

Full configuration, workspace layout, message protocol, remote access, and HTTPS deployment are documented in [docs/en/operations.md](docs/en/operations.md).

## Development

```sh
bun run dev       # frontend watch + API on one port
bun test
bun run typecheck
bun run build
bun run build:binary
bun run screenshots   # regenerate README screenshots (needs Chrome/Chromium)
```

## Documentation

- [Operations and deployment](docs/en/operations.md)
- [Architecture](docs/en/architecture.md)
- [Connectors and event protocol](docs/en/connectors.md)

Chinese: [README.md](README.md) · [中文文档](docs/operations.md)

## Contributing

Issues and pull requests are welcome.

- Run `bun test`, `bun run typecheck`, and `bun run build` before submitting.
- Keep changes focused. Update docs and tests when changing protocols or storage.
- Never commit real API keys, tokens, workspace data, or private screenshots.

## License

This project does not ship an open-source license yet; all rights are reserved by default. Choose a license before public release or external contributions.
