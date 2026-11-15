# 架构

[English](en/architecture.md) · 中文

## 总览

```text
Browser (React)
      │ HTTP / SSE
      ▼
dudu server (Bun)
      ├── Store (SQLite)
      ├── Scheduler ──► Pi AgentSession
      ├── ConnectorRegistry（外部 command / http / mcp）
      └── Computer / BotdSupervisor ──► Xvfb / Xfce / voxl
```

配置和 Bot 数据以工作区文件为唯一真相；SQLite 保存事件队列、聊天时间线、Bot 间历史、运行状态和会话路径。

## Store

`Store` 是中心持久化层和事件总线。

- `events`：Agent 收件箱。包含 seq、来源、优先级、delivery、投递状态和原始 body。
- `messages`：主聊天时间线。包含普通消息、提问、reaction、Bot 间提示、附件元数据。
- `bot_messages`：Bot 对 Bot 的往来正文。
- `sessions`：每个 Bot 的 Pi session 路径。
- `runs`：每次运行的开始、结束和状态。

`publish()` 写入事件并通知监听器；SSE 用它回放，Scheduler 只响应 `delivery="wake"`。`pending()/pendingSeq()` 是 Agent 的输入队列，`mark()` 推进投递状态。

`delivery` 分三档：`wake` 立即唤醒；`digest` 不唤醒，但进入下一次 prompt 的环境变化摘要；`ignore` 只用于 UI/遥测。用户 reaction 属于 `wake`（直接反馈，是否回复由 Bot 决定）。每个 Bot 有独立的 `context_seq`，digest 事件只在下次真正运行时消费一次。

事件去重键为 `botId + sourceId + dedupeKey`，eventId 全局唯一。重启时 `delivering` 恢复为 `pending`。

## Scheduler

每个 Bot 同时只有一个 Pi session 和模型执行循环。

- **空闲时**：取全部 pending 事件，按 `seq` 合并为一个 prompt 交付；所有事件一起标记 `delivering`，只创建一个 run。若存在 digest，会作为这次 prompt 的前缀。
- **运行中**：新事件按 priority 处理，`high` 使用 steer，其余使用 followUp。
- 任何 `delivery="wake"` 事件都会唤醒 Scheduler，包括 Bot 对 Bot 的消息和 Agent 自己提交的事件；不会等下一次人类消息。
- 决策锁只保护短入队逻辑，不等模型整轮。
- `agent_end` 不结算；`agent_settled` 才结算本轮。
- 暂停/停止会清空 SDK 队列、abort，并取消收件箱中的待处理输入。
- 没有可用模型时 pending 事件保留，配置恢复后继续。

Bot 对 Bot 有按 Bot 对的自动轮次预算；超过阈值后消息仍记录，但不会立即唤醒接收方，而是进入其下一次运行的 digest。人类消息会重置该 Bot 对对应的预算。

## 消息与事件

人类消息：

```text
POST /api/messages
  → messages 表写入用户气泡
  → events 表写入 message.web (delivery=wake)
  → Scheduler 交付给 Agent
```

Bot 可见回复：

```text
message_send
  → messages 表写入消息
  → 不产生新的 wake 投递
```

Bot 对 Bot：

```text
message_send route={kind:'bot'}
  → bot_messages 表记录正文
  → events 表写入 message.bot (delivery=wake) 给接收方
  → 双方 messages 表各写入一条 bot_out / bot_in 提示
```

`messages` 的 `kind` 支持 `message`、`ask`、`reaction`、`takeover`、`bot_out`、`bot_in`。附件会复制到 Bot 的 `artifacts/`，消息只保存元数据和鉴权 URL。

## 电脑

- 每个 Bot 拥有独立桌面；dudu 进程内的 supervisor 负责 Xvfb、窗口管理器、私有 HOME、DBus 和 voxl。
- Agent 的 computer 工具是 dudu 内置能力，直接调用 `Computer.cua()`，不经过连接器、MCP 或 HTTP。
- 桌面默认在 dudu 启动时自动恢复（可在设置中关闭）；Bot 工具首次使用时会懒启动已停止的桌面，并可直接调用 `status` / `start` / `stop`。
- dudu 通过 `/api/bots/:botId/computer/live/` 同源代理 voxl 的 HTTP 和 WebSocket；远程访问无需额外开放 voxl 端口。
- 浏览器需要 HTTPS 或 localhost 才能使用 WebCodecs 解码实时画面。
- 同 UID 的桌面会话不是安全沙箱。

## HTTP API

- `GET /api/state`：配置、Bot、消息、Bot 线程、连接器、事件源、状态。
- `POST /api/bots`，`PUT/DELETE /api/bots/:id`，`POST /api/bots/:id/pause|resume|stop`。
- `GET /api/bots/:botId/peers/:peerId/messages`：Bot 间完整往来。
- `POST /api/messages`，`POST /api/reactions`。
- `PUT /api/providers`，`PUT /api/defaults`，`PUT /api/computer-settings`（启动时自动拉起桌面）。
- `POST /api/connectors`，`POST /api/sources`，`POST /api/sources/:id/enable|disable|trigger`，`DELETE /api/sources/:id`。
- 电脑：`GET .../computer/status|shot|watch`，`POST .../start|stop|takeover`。
- `GET /api/events?after=N`，`GET /api/stream`（SSE，支持 Last-Event-ID/after）。
- `GET /api/artifacts/:botId/:name`：鉴权后读取 Bot 附件与截图。

## 边界

- 外部副作用不承诺 exactly-once；连接器应使用 eventId 或来源幂等键。
- 配置改动后，空闲时装配新 session；明确记录的 `.pi/session.jsonl` 路径优先，不猜测最近会话。
- 第三方 MCP 连接器的生命周期由官方客户端管理；内置电脑能力不走 MCP。
