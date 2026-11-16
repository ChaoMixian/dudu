# 运行与部署

[English](en/operations.md) · 中文

这份文档面向需要自己运行、部署或二次开发 dudu 的人。产品介绍见 [README](../README.md)。

## 环境要求

- Bun（运行与构建）
- Node.js（Vite 构建）
- Linux 桌面能力（仅电脑功能需要）：
  - Xvfb、xfce4-session、xfwm4、xfce4-panel、xfdesktop、xauth、xdpyinfo、xprop、xdotool、xclip、dbus-daemon、ffmpeg
  - [tembo/voxl](https://github.com/tembo/voxl)：`cargo install voxl-server`，需要 x264/libyuv/opus/libpulse/esbuild
  - 可选：xfce4-terminal、thunar

dudu 不会自动安装系统包，也不会修改你的默认桌面会话。

## 启动

```sh
bun install --frozen-lockfile
bun run build
bun run start
```

开发模式（前端 watch + API 同一端口）：

```sh
bun run dev
```

单文件版本：

```sh
bun run build:binary
./release/dudu
```

电脑桌面由 dudu 进程内的 supervisor 直接管理，不需要额外的 botd 进程。

启动 dudu 的进程必须能在 `PATH` 里找到 `voxl`（通常用 `cargo install voxl-server` 安装到 `~/.cargo/bin`）。示例：

```sh
PATH="$HOME/.cargo/bin:$PATH" bun run start
```

单文件二进制也一样，只是不再需要 Node 与 `dist/`。

默认地址：http://127.0.0.1:7331

桌面会话由 dudu 进程直接管理，不暴露独立的 botd HTTP 端口；远程访问只需通过 HTTPS 反向代理访问 dudu。

## 工作区

默认根目录 `~/Workspace`，可用 `DUDU_WORKSPACE` 覆盖。

配置的唯一真相是工作区里的文件：

```text
<workspace>/
├── .dudu/config.json          # 全局配置、provider、默认模型
├── .dudu/state.sqlite         # 收件箱、序号、运行状态、会话路径
├── .dudu/botd/                # 桌面状态、私有 HOME 与运行时数据
├── connectors/<id>/connector.json
└── bots/<botId>/
    ├── bot.json
    ├── AGENTS.md
    ├── MEMORY.md
    ├── work/                  # Bot 的工作目录
    ├── home/                  # Bot 的私有目录
    ├── sources/
    ├── artifacts/             # 附件、截图等
    └── .pi/                   # Pi session
```

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `DUDU_WORKSPACE` | 工作区根目录 |
| `DUDU_HOST` | API 监听地址，默认 `127.0.0.1` |
| `DUDU_PORT` | API 端口，默认 `7331` |
| `DUDU_BOTD_ROOT` | 桌面数据目录，默认 `<workspace>/.dudu/botd` |
| `DUDU_TOKEN` | Bearer token；也可在 config.json 中设置 |
| `DUDU_URL` | CLI 访问的 dudu 地址 |
| `UI_PREVIEW_PORT` | 隔离 UI 预览端口 |

暴露到局域网或公网前必须设置 token，并配合 HTTPS 反向代理与访问控制。

## 模型服务

可以在设置 → 模型服务中图形化添加，也可以直接写 `config.json`：

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

- `api` 支持 `openai-completions`、`openai-responses`、`anthropic-messages`
- API 密钥与配置一起以明文保存在 `.dudu/config.json`，文件权限为 `0600`
- 可以在界面中从上游获取模型列表
- Bot 不强制绑定模型；未选择时使用全局默认模型

## Bot 消息协议

Bot 的所有用户可见输出都必须通过 `message_send`。`kind` 支持：

- `message`：普通消息，可带快捷回复选项
- `ask`：提问，选项纵向排列，最后一行允许自由输入
- `reaction`：用 `targetId` 和 `emoji` 对指定消息加回应
- `takeover`：显示“接管电脑”按钮

附件：

```json
{
  "attachments": [
    { "path": "report.pdf" },
    { "path": "/absolute/path/inside/bot/artifacts/chart.png", "name": "chart.png" }
  ]
}
```

- 路径相对 Bot 的 `work/`，绝对路径必须位于 Bot 工作区内
- 最多 8 个文件，单个文件最大 50 MiB
- 图片、视频、音频、PDF、文本会内嵌预览；其他类型显示下载卡片
- 文件会复制到 `artifacts/`，通过鉴权接口提供

Bot 间通信的保护：

- Bot 间事件有 1 秒合并窗口，空闲时按 seq 一次性交付
- 每对 Bot 自上次人类发言后最多自动互发 20 条
- 超过 20 条后消息仍然保存并显示在往来记录中；不会立即唤醒对方，但会进入对方下一次运行的 digest
- `message_send` 返回和收到的 Bot 事件都会带 `remaining`；为 0 时提示 Bot 停止并请人类继续
- 人类给其中任一 Bot 发消息会重置该 Bot 相关的计数

## 连接器与电脑

连接器是全工作区共享的，所有 Bot 都可以直接使用，不需要逐个 Bot 绑定。

电脑桌面不需要配置服务地址。每个 Bot 自动获得独立桌面：

- dudu 进程内的 supervisor 负责启动 Xvfb/桌面会话
- Agent 的 computer 工具是 dudu 内置能力，直接调用 `Computer.cua()`，不经过连接器、MCP 或 HTTP
- 设置 → 连接器里的“启动时自动拉起桌面”控制 dudu 启动时是否恢复所有桌面（默认开启）
- 即使关闭该开关，Bot 第一次调用电脑工具时也会自动启动自己已停止的桌面
- Bot 也可以直接调用 `computer__status` / `computer__start` / `computer__stop`
- dudu 以 `/api/bots/:botId/computer/live/` 同源代理 voxl 的 HTTP 与 WebSocket
- 浏览器需要 **HTTPS 或 localhost** 才能使用 WebCodecs 解码电脑画面

## 高级模式

在 **设置 → 高级** 开启后，Bot 页面右侧会出现独立的全高工具面板；文件 / 终端 / Session / 电脑以浏览器式标签页打开，起始页用于选择工具，左边缘可拖动调宽，拖窄到一定程度会关闭面板但保留标签页。标签栏左侧的按钮可以搜索、切换和关闭标签页；标签溢出时边缘渐隐。左侧侧边栏也可拖动，拖窄后收成图标栏。关闭时这些入口和面板完全隐藏，输入框的上传、拖拽和粘贴附件仍然可用。

- **文件**：只开放 Bot 工作区的 `work/`、`artifacts/`、`AGENTS.md`、`MEMORY.md`；拒绝绝对路径、`..` 和符号链接。单次最多 8 个文件、每个 50 MiB。
- **终端**：在 Bot 桌面环境的 PTY 中运行 bash（不可用时回退到 `/bin/sh`），默认 cwd 为 `work/`。关闭面板或切换 Bot 只断开连接，PTY 继续运行；重新打开会接回原终端。关闭终端标签或停止桌面才会结束。PTY 尺寸跟随面板宽度调整。
- **Session**：按 256 KiB 窗口读取 `.pi/session.jsonl`，向上滚动加载更早记录，并通过 SSE 推送实时事件；工具结果和 base64 图片会被裁剪或摘要化。
- **电脑**：直接查看和操作当前 Bot 的桌面。
- 高级模式只做界面收敛，不是权限隔离；文件、终端和桌面仍以运行 dudu 的用户身份访问本机。

## 远程访问

- 推荐通过 HTTPS 反向代理访问 dudu；如果使用 frp，请同时转发 HTTP 和 WebSocket，并保持同一源
- 电脑流已经走 dudu 同一端口，不需要额外开放 voxl 端口
- 自签证书需要浏览器信任，否则部分浏览器能力（如 WebCodecs）可能不可用

## CLI

```sh
bun src/cli.ts bots list
bun src/cli.ts bots new '{"name":"Alice"}'
bun src/cli.ts send alice '你好，请通过 message_send 回复。'
bun src/cli.ts events list
bun src/cli.ts events register '{"id":"wake-alice","botId":"alice","kind":"interval","enabled":true,"priority":"low","payload":{"task":"检查任务"},"intervalMs":60000}'
bun src/cli.ts events trigger wake-alice
bun src/cli.ts events disable wake-alice
```

`DUDU_URL` 指定服务地址，`DUDU_TOKEN` 指定 Bearer token。

## 验证

```sh
bun test
bun run typecheck
bun run build
```

无真实 provider 时的端到端自检：

```sh
bun examples/fixtures/model-fixture.ts 7340 &
# 在模型服务页添加：
# baseUrl http://127.0.0.1:7340/v1
# api openai-completions
# API key fixture-key
# model fixture-model
```

更多内部语义见：

- [架构](architecture.md)
- [连接器与事件协议](connectors.md)
