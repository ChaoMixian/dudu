# Architecture

[中文](../architecture.md) · English

## Overview

```text
Browser (React)
      │ HTTP / SSE
      ▼
dudu server (Bun)
      ├── Store (SQLite)
      ├── Scheduler ──► Pi AgentSession
      ├── ConnectorRegistry (computer is an in-process local connector)
      └── Computer / BotdSupervisor ──► Xvfb / Xfce / voxl
```

Workspace files are the source of truth for configuration and Bot data. SQLite stores the event queue, chat timeline, Bot-to-Bot history, run state, and session paths.

## Store

`Store` is the central persistence layer and event bus.

- `events`: the Agent inbox. Includes seq, source, priority, wake, delivery state, and the original body.
- `messages`: the main chat timeline. Includes normal messages, questions, reactions, Bot-to-Bot notices, and attachment metadata.
- `bot_messages`: Bot-to-Bot message bodies.
- `sessions`: the Pi session path for each Bot.
- `runs`: the start, end, and state of each run.

`publish()` writes an event and notifies listeners. SSE uses it for replay, and the Scheduler uses it to react to `wake=true`. `pending()` / `pendingSeq()` are the Agent input queue; `mark()` advances delivery state.

The dedupe key is `botId + sourceId + dedupeKey`. Event IDs are globally unique. On restart, `delivering` returns to `pending`.

## Scheduler

Each Bot has exactly one Pi session and one model execution loop at a time.

- **Idle**: take all pending events and deliver them as one prompt in `seq` order; mark them all `delivering` and create one run.
- **Running**: new events follow priority; `high` uses steer and the rest use followUp.
- Any event with `wake=true` wakes the Scheduler, including Bot-to-Bot messages and events submitted by the Agent itself; it does not wait for the next human message.
- The decision lock only covers short enqueue logic, not the whole model turn.
- `agent_end` does not settle the run; `agent_settled` does.
- Pause/stop clears the SDK queue, aborts the turn, and cancels pending input in the inbox.
- When no model is available, pending events stay queued and resume after configuration is fixed.

Bot-to-Bot communication has a per-pair automatic turn budget. Beyond the threshold, messages are still recorded but do not wake the receiver. A human message resets the budget for that pair.

## Messages and events

Human message:

```text
POST /api/messages
  → write the user bubble to messages
  → write message.web to events (wake=true)
  → the Scheduler delivers it to the Agent
```

Bot-visible reply:

```text
message_send
  → write the message to messages
  → no new wake event
```

Bot-to-Bot:

```text
message_send route={kind:'bot'}
  → record the body in bot_messages
  → write message.bot to events (wake=true) for the receiver
  → write one bot_out / bot_in notice to each side's messages
```

`messages.kind` supports `message`, `ask`, `reaction`, `takeover`, `bot_out`, and `bot_in`. Attachments are copied into the Bot's `artifacts/`; messages store only metadata and authenticated URLs.

## Computers

- Each Bot has its own desktop. A supervisor inside the dudu process owns Xvfb, the window manager, the private HOME, D-Bus, and voxl.
- Agent computer tools are in-process `local` connectors that call `Computer.cua()` directly, with no MCP or HTTP hop.
- Desktops are restored at dudu startup by default (configurable in Settings). The first computer tool call also starts a stopped desktop, and Bots can call `status` / `start` / `stop` directly.
- Only the standalone debugging mode (`dudu botd serve`) starts a loopback HTTP server.
- dudu proxies voxl HTTP and WebSocket through `/api/bots/:botId/computers/:bindingId/live/`; remote access needs no extra voxl port.
- Browsers need HTTPS or localhost for WebCodecs to decode the live stream.
- Same-UID desktop sessions are not a security sandbox.

## HTTP API

- `GET /api/state`: config, Bots, messages, Bot threads, connectors, event sources, and status.
- `POST /api/bots`; `PUT` / `DELETE /api/bots/:id`; `POST /api/bots/:id/pause|resume|stop`.
- `GET /api/bots/:botId/peers/:peerId/messages`: full Bot-to-Bot history.
- `POST /api/messages`, `POST /api/reactions`.
- `PUT /api/providers`, `PUT /api/defaults`, `PUT /api/computer-settings` (desktop auto-start).
- `POST /api/connectors`, `POST /api/sources`, `POST /api/sources/:id/enable|disable|trigger`, `DELETE /api/sources/:id`.
- Computers: `GET .../computers/:bindingId/status|shot|watch`, `POST .../start|stop|takeover`.
- `GET /api/events?after=N`, `GET /api/stream` (SSE with Last-Event-ID / after).
- `GET /api/artifacts/:botId/:name`: authenticated Bot attachments and screenshots.

## Boundaries

- External side effects are not exactly-once. Connectors should use the eventId or a source idempotency key.
- After a config change, a new session is assembled while idle. An explicitly recorded `.pi/session.jsonl` path wins; dudu never guesses the most recent session.
- Third-party MCP connectors are managed by the official client. The built-in computer connector does not use MCP.
