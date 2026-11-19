<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/brand/png/dudu-logo-horizontal-dark-1024.png">
  <img src="docs/brand/png/dudu-logo-horizontal-1024.png" alt="dudu" width="240">
</picture>

中文 · [English](README.en.md)

![status](https://img.shields.io/badge/status-alpha-orange)
![TypeScript](https://img.shields.io/badge/TypeScript-7.x-3178C6?logo=typescript&logoColor=white)
![Bun](https://img.shields.io/badge/Bun-runtime-f9f1e1?logo=bun&logoColor=000)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=000)

**dudu 是一个本地优先的 Bot 运行时。每个 Bot 拥有持久身份、独立记忆、工作区和一台自己的 Linux 桌面。**

dudu 把 Bot 当作长期在线的协作对象，而不是一次性的聊天窗口。Bot 可以在你离开后继续处理消息、定时任务和外部事件，也可以主动与你沟通、发送文件、和其他 Bot 协作，或请求你接管它的电脑。

![dudu](docs/assets/dudu-chat.png)

## 特性

- **长期在线**：每个 Bot 保留自己的记忆、文件和会话；关掉页面后仍会处理消息、定时任务和外部事件。
- **独立电脑**：每个 Bot 有自己的 Linux 桌面，可以打开浏览器、终端和桌面应用。
- **主动沟通**：Bot 会主动发消息、提问、发送文件，也能请求你接管电脑。
- **Bot 协作**：Bot 之间可以互发消息、分工和交接，完整往来可查看。
- **开箱即用的连接**：Bark、微信、天气、iCloud/CalDAV、Outlook 日历，以及从 skills.sh 或仓库安装的技能。
- **本地优先**：配置、记忆、文件和会话都保存在本机工作区。

Bot 之间的完整往来记录：

![Bot conversation](docs/assets/dudu-bot-thread.png)

## 快速开始

### 前置条件

- [Bun](https://bun.sh/)
- Node.js 20.19+ 或 22.12+（Vite 8 构建要求）
- 电脑功能需要 Linux X11 桌面依赖和 [voxl](https://github.com/tembo/voxl)（`voxl` 需在 `PATH` 中），详见 [运行文档](docs/operations.md)

### 安装与运行

```sh
bun install
bun run build
bun run start
```

打开 http://127.0.0.1:7331。电脑桌面由 dudu 自己管理，无需单独启动服务。需要电脑功能时，确保 `voxl` 在 `PATH` 中（例如 `PATH="$HOME/.cargo/bin:$PATH" bun run start`）。

需要分发的单文件版本：

```sh
bun run build:binary
./release/dudu
```

`release/dudu` 已内嵌前端资源，单文件即可运行。

### 首次使用

首次打开 dudu 会进入设置向导。之后可通过 **新建机器人** 添加更多 Bot。

### 高级模式

在 **设置 → 高级** 中开启后，Bot 页面右侧会出现工具面板，文件、终端、Session 和电脑以标签页打开。

- **文件**：浏览和管理 Bot 工作区文件。
- **终端**：在 Bot 的桌面环境中打开终端，关闭页面后仍会继续运行。
- **Session**：查看 Bot 的实时会话、工具调用和结果。
- **电脑**：查看和操作当前 Bot 的桌面。

不开启高级模式时，这些入口不会出现，普通对话仍支持附件上传。

## 工作原理

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

- `Store` 负责事件收件箱、聊天时间线、Bot 间历史和运行状态。
- `Scheduler` 按顺序向 Agent 交付事件，并处理空闲唤醒与积压批量投递。
- 每个 Bot 的 Agent 运行在独立的 Pi session 中。
- 电脑会话由 dudu 进程内的 supervisor 管理；画面仍通过同源代理提供。

更完整的设计说明见 [架构文档](docs/architecture.md)。

## 配置

常用环境变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DUDU_WORKSPACE` | `~/Workspace` | 工作区根目录 |
| `DUDU_HOST` | `127.0.0.1` | API 监听地址 |
| `DUDU_PORT` | `7331` | API 端口 |
| `DUDU_TOKEN` | 空 | Bearer token，启用鉴权 |

完整配置、工作区结构、消息协议、远程访问和 HTTPS 部署见 [docs/operations.md](docs/operations.md)。

## 开发

```sh
bun run dev       # 前端 watch + API，同一端口
bun test
bun run typecheck
bun run build
bun run build:binary
bun run screenshots   # 重新生成 README 截图（需要 Chrome/Chromium）
```

## 文档

- [运行与部署](docs/operations.md)
- [架构](docs/architecture.md)
- [技能](docs/skills.md)
- [连接器与事件协议](docs/connectors.md)

英文版：[README.en.md](README.en.md) · [English docs](docs/en/operations.md)

## 贡献

欢迎提交 issue 和 pull request。

- 提交前请运行 `bun test`、`bun run typecheck` 和 `bun run build`。
- 保持改动聚焦；涉及协议或存储结构时，请同步更新文档和测试。
- 不要提交真实 API key、token、工作区数据或私人截图。

## 许可证

本项目目前未添加开源许可证，默认保留所有权利。在公开发布或接受外部贡献前，需要先确定许可证。
