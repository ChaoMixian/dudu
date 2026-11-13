# Connectors and event sources

[中文](../connectors.md) · English

## Shared connectors

`new ConnectorRegistry(workspaceRoot)` reads `connectors/<id>/connector.json` on demand. JSON files are the source of truth.

Connectors are shared across the workspace. Every Bot can use them directly; no per-Bot binding is required. `computer` is the exception in one respect: the connector itself is shared, but every Bot has its own desktop and internal binding.

Connector definition:

```json
{
  "id": "weather",
  "name": "Weather",
  "description": "HTTP weather tool",
  "transport": "http",
  "url": "https://weather.example/api",
  "tools": [
    {
      "name": "forecast",
      "description": "Get a forecast",
      "parameters": { "type": "object", "properties": { "city": { "type": "string" } } }
    }
  ]
}
```

`transport` supports `command`, `http`, `mcp`, and `local`. `local` is reserved for built-in connectors whose tools run inside the dudu process. Connector configuration is operator input, not model-generated arguments. Do not register untrusted executables or URLs. These adapters are not OS sandboxes.

## Command

`spawn(argv[0], argv.slice(1))`, without a shell. The request is written to stdin as one JSON object, then stdin is closed:

```json
{"tool":"echo","arguments":{"text":"hello"},"config":{}}
```

The process must exit with 0 and write exactly one JSON value to stdout; diagnostics go to stderr. The default timeout is 60 seconds and the stdout limit is 4 MiB. Cancellation terminates the process group. Only `PATH/HOME/TMPDIR/LANG/TZ` and explicitly configured environment variables are inherited.

Example: `examples/command-tool.ts`.

## HTTP

POST the same JSON envelope to a fixed URL; a successful response must be JSON. Headers from the connector and internal binding are merged. Non-2xx responses, cancellation, timeouts, and oversized output all fail.

URLs and headers are trusted operator configuration; this is not an SSRF-filtering proxy.

## MCP

MCP connectors are delegated to the official `@earendil-works/pi-coding-agent` client. dudu only generates explicit `mcpServers` configuration and does not implement MCP transport, OAuth, discovery, or process lifecycle.

- The server name is the connector ID
- `exposure: "direct"`
- Fixed argv maps to `command/args`
- Remote connectors keep URL/headers

MCP client environment and lifecycle follow the official implementation.

## Event sources

`SourceManager` reads `bots/<botId>/sources/<id>.json`. Source IDs are globally unique. SQLite stores only cursors and recent run logs.

Required fields: `id`, `botId`, `kind`, `enabled`, `priority`, `payload`.

- `once`: ISO `at`; completion is persisted
- `interval`: `intervalMs >= 10`
- `cron`: cron expression plus optional IANA timezone
- `webhook`: triggered through the authenticated ingress
- `process`: fixed argv, JSON lines on stdout, stderr logged

Each process event line must be an object; without `payload`, the whole line becomes the payload. Bot/source identity and priority always come from the source configuration. Process output has a 1 MiB line limit and a 256-event pending limit. Unexpected exits restart with exponential backoff, capped at 60 seconds.

Missed interval/cron ticks coalesce into at most one run per tick. The goal is to avoid an unbounded catch-up replay, not to guarantee delivery of every missed tick. For reliable delivery, write to a durable inbox from the callback.

Available methods: `list`, `get`, `register`, `enable`, `remove`, `trigger`, `tick`, `start`, `stop`.

## Built-in computer connector

`computer` is registered at startup as a built-in connector with `transport: "local"`. Agents call `Computer.cua()` directly, and a supervisor inside the dudu process operates the current Bot's desktop. There is no MCP subprocess, no botd HTTP client, and no token.

Desktops are still hosted by external processes (Xvfb, xfce, voxl). `dudu botd serve` remains only as a standalone debugging backend.

Tool surface:

- Lifecycle: `status`, `start`, `stop` (Agent-side names are `computer__status`, etc.)
- Lazy start: other computer tools start a stopped desktop before running
- Screen: screenshot (PNG/JPEG/WebP, region, scaling, cursor), size, displays
- Pointer: click, double click, right click, move, drag, scroll, button down/up
- Keyboard: type, key combinations, key down/up
- Clipboard: read/write
- Shell: run commands, background processes, read output, kill
- Terminal: PTY create, send, read, close
- Files: text/byte read/write, list, make directory, remove, exists, size
- Windows: list, active title, activate

Capabilities without a reliable X11 equivalent are not implemented (mobile gestures, app-store install, CDP browser tools, audio, and so on).

HTTP callers can also use `POST /v1/desktops/:id/cua/<method>`; `BotdClient.cua(id, method, args)` is a convenience wrapper.

## Tests

```sh
bun test tests/connectors.test.ts tests/sources.test.ts
```

Tests use temporary workspaces and in-memory SQLite, covering the protocol, environment isolation, cancellation, MCP mapping, validation, cursor persistence, and process restart.
