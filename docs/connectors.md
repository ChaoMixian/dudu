# 连接器与事件源

[English](en/connectors.md) · 中文

## 共享连接器

`new ConnectorRegistry(workspaceRoot)` 按需读取 `connectors/<id>/connector.json`，JSON 文件是唯一真相。

连接器对整个工作区共享，所有 Bot 都能直接使用，不需要逐个 Bot 绑定。`computer` 不是连接器，而是 dudu 的内置能力：每个 Bot 自动拥有自己的桌面。

连接器定义：

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

`transport` 支持 `command`、`http`、`mcp`、`builtin`。`builtin` 是 dudu 直接实现的内置服务；普通用户从“添加连接器”目录配置，同一 provider 可以添加多个实例。连接器配置是运维输入，不是模型生成的参数；不要注册不受信任的可执行文件或 URL。这些适配器不是 OS 沙箱。

## 内置连接器

- **Bark**：填写 Bark App 里的推送地址，自动解析服务器和设备 Key；工具 `send`。
- **天气**：填写城市；使用 Open-Meteo 查询当前天气、预报和空气质量，无需 API Key。
- **CalDAV**：读写 iCloud 或任意标准 CalDAV 日历。iCloud 使用 `https://caldav.icloud.com` + Apple ID + App 专用密码；工具为 `list_calendars`、`list_events`、`create_event`、`update_event`、`delete_event`。
- **Outlook Calendar**：使用内置 Microsoft 应用和设备码登录，无需填写 Client ID、无回调、无 client secret。自建应用可设置 `DUDU_MICROSOFT_CLIENT_ID` 和 `DUDU_MICROSOFT_TENANT`；工具与 CalDAV 相同。
- **微信**：绑定一个 Bot，使用官方扫码登录和 `getupdates` 长轮询，不需要公网回调。

添加需要登录的连接器时，先完成配置再授权；编辑只保存配置，登录和退出是独立操作。

### 微信

微信连接器入站时：

1. 把微信文本写入该 Bot 的主时间线；
2. 发布 `message.weixin` 事件，payload 带 `peer`、`messageId` 和 `externalReply`；
3. Bot 调用 `externalReply.tool`（即 `<连接器ID>__send_text`）回复微信，工具会同时把回复记录到主时间线；
4. Bot 也可以改用 `message_send` 只回复 dudu Web。

工具 `send_text` 用于主动发消息：`to` 省略时发给最近联系人。当前只处理文本；图片、语音和文件显示为占位。微信登录态、游标、联系人和最近消息保存在 `<workspace>/.dudu/weixin/`。

## Command

`spawn(argv[0], argv.slice(1))`，不经过 shell。请求以一个 JSON 对象写入 stdin，然后关闭 stdin：

```json
{"tool":"echo","arguments":{"text":"hello"},"config":{}}
```

进程必须以 0 退出，并在 stdout 输出恰好一个 JSON 值；诊断输出写 stderr。默认 60 秒超时、4 MiB stdout 上限，取消时终止进程组。只继承 `PATH/HOME/TMPDIR/LANG/TZ` 和显式配置的环境变量。

示例：`examples/command-tool.ts`。

## HTTP

向固定 URL POST 同样的 JSON envelope，成功响应必须是 JSON。连接器和内部绑定配置的 headers 会合并。非 2xx、取消、超时或超限都会失败。

URL 与 headers 是运维可信配置；这不是 SSRF 过滤代理。

## MCP

MCP 连接器交给官方 `@earendil-works/pi-coding-agent` 客户端。dudu 只生成显式 `mcpServers` 配置，不实现 MCP 传输、OAuth、发现或进程生命周期。

- 服务器名使用连接器 ID
- `exposure: "direct"`
- 固定 argv 映射为 `command/args`
- 远程连接器保留 URL/headers

MCP 客户端的环境和生命周期遵循官方实现。

## 事件源

`SourceManager` 读取 `bots/<botId>/sources/<id>.json`，源 ID 全局唯一。SQLite 只保存游标和最近运行日志。

必填字段：`id`、`botId`、`kind`、`enabled`、`priority`、`payload`。

- `once`：ISO `at`，持久化完成状态
- `interval`：`intervalMs >= 10`
- `cron`：cron 表达式和可选 IANA 时区
- `webhook`：由认证后的 ingress 调 `trigger`
- `process`：固定 argv，stdout JSON-lines，stderr 记日志

进程事件每行必须是一个对象；缺少 `payload` 时整行作为 payload。Bot/source 身份和优先级始终由源配置决定。进程输出有 1 MiB 行限制和 256 事件待处理上限；异常退出按指数退避重启，最长 60 秒。

错过的 interval/cron 在每个 tick 最多合并为一次执行；优先避免无限补跑，不保证每次错过都送达。需要可靠投递时，在回调里写入持久收件箱。

可用方法：`list`、`get`、`register`、`enable`、`remove`、`trigger`、`tick`、`start`、`stop`。

## 内置电脑能力

`computer` 不是连接器，也不写入 `connectors/`。每个 Bot 都有内置的电脑能力和独立桌面；Agent 直接调用 `Computer.cua()`，由 dudu 进程内的 supervisor 操作当前 Bot 的桌面。没有 MCP 子进程、没有 botd HTTP 客户端，也不需要 token。

桌面仍由外部进程承载（Xvfb、xfce、voxl），但不再提供独立的 botd 守护进程。

工具面覆盖：

- 生命周期：`status`、`start`、`stop`（Agent 侧名称分别为 `computer__status` 等）
- 懒启动：其他电脑工具在桌面为 `stopped` 时会先自动启动再执行
- 屏幕：截图（PNG/JPEG/WebP、区域、缩放、光标）、尺寸、显示器
- 指针：点击、双击、右键、移动、拖拽、滚动、按下/释放
- 键盘：输入、组合键、按下/释放
- 剪贴板：读取/写入
- Shell：运行命令、后台进程、读取输出、终止
- 终端：PTY 创建、输入、读取、关闭
- 文件：文本/字节读写、列表、创建目录、删除、存在性、大小
- 窗口：列表、活动窗口、激活

不实现没有可靠 X11 等价物的能力（移动端手势、应用商店安装、CDP 浏览器工具、音频等）。

电脑能力只在 dudu 进程内使用，不提供独立的 botd HTTP 桌面 API。

## 测试

```sh
bun test tests/connectors.test.ts tests/builtin-connectors.test.ts tests/web-connectors.test.ts tests/sources.test.ts
```

测试使用临时工作区和内存 SQLite，覆盖协议、环境隔离、取消、MCP 映射、校验、游标持久化和进程重启。
