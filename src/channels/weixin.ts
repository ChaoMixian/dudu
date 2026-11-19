import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Connector } from '../connectors';
import type { ConnectorRegistry } from '../connectors';
import type { Store } from '../core/store';

const FIXED_BASE_URL = 'https://ilinkai.weixin.qq.com';
const CLIENT_VERSION = 132106; // 2.4.10 encoded as major<<16 | minor<<8 | patch
const CHANNEL_VERSION = '2.4.10';
const BOT_AGENT = 'dudu/0.1.2';
const LONG_POLL_TIMEOUT = 35_000;
const SEND_TIMEOUT = 15_000;
const CHUNK_SIZE = 2000;

interface WeixinMessageItem { type?: number; msg_id?: string; text_item?: { text?: string }; voice_item?: { text?: string } }
interface WeixinMessage {
  message_id?: string;
  from_user_id?: string;
  to_user_id?: string;
  message_type?: number;
  item_list?: WeixinMessageItem[];
  context_token?: string;
}

interface WeixinState {
  syncBuf?: string;
  lastPeer?: string;
  peers?: Record<string, { peer: string; name?: string; contextToken?: string; lastAt: string }>;
  seen?: string[];
}

interface Runtime {
  abort: AbortController;
  running: boolean;
  state: 'logged_out' | 'connecting' | 'connected' | 'error';
  error?: string;
  lastMessageAt?: string;
  accountId?: string;
  userId?: string;
}

interface LoginSession {
  connectorId?: string;
  sessionKey: string;
  qrcode: string;
  qrUrl: string;
  baseUrl: string;
  startedAt: number;
}

export interface WeixinStatus {
  connectorId: string;
  state: 'logged_out' | 'connecting' | 'connected' | 'error';
  accountId?: string;
  userId?: string;
  error?: string;
  lastMessageAt?: string;
}

function ensureJsonInts(text: string): string {
  let output = '';
  let index = 0;
  while (index < text.length) {
    const char = text[index]!;
    if (char === '"') {
      const start = index++;
      let escaped = false;
      while (index < text.length) {
        const next = text[index++]!;
        if (escaped) escaped = false;
        else if (next === '\\') escaped = true;
        else if (next === '"') break;
      }
      output += text.slice(start, index);
      continue;
    }
    if (char === '-' || (char >= '0' && char <= '9')) {
      const start = index++;
      while (index < text.length && /[0-9.eE+-]/.test(text[index]!)) index++;
      const token = text.slice(start, index);
      const isInteger = /^-?\d+$/.test(token);
      output += isInteger && token.replace(/^-/, '').length > 15 ? `"${token}"` : token;
      continue;
    }
    output += char;
    index++;
  }
  return output;
}

function parseJson(text: string): any {
  try { return JSON.parse(ensureJsonInts(text)); } catch { return JSON.parse(text); }
}

function randomUin(): string {
  const value = crypto.getRandomValues(new Uint32Array(1))[0]!;
  return Buffer.from(String(value), 'utf8').toString('base64');
}

function commonHeaders(): Record<string, string> {
  return {
    'iLink-App-Id': 'bot',
    'iLink-App-ClientVersion': String(CLIENT_VERSION),
    'X-WECHAT-UIN': randomUin(),
  };
}

function authHeaders(token?: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    AuthorizationType: 'ilink_bot_token',
    ...commonHeaders(),
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

function baseInfo() {
  return { channel_version: CHANNEL_VERSION, bot_agent: BOT_AGENT };
}

async function request(url: string, init: RequestInit, timeoutMs: number, signal?: AbortSignal): Promise<any> {
  const response = await fetch(url, { ...init, signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(timeoutMs)]) });
  const text = await response.text();
  if (!response.ok) throw new Error(`WeChat API ${response.status}: ${text.slice(0, 400)}`);
  return text ? parseJson(text) : {};
}

export async function startQrLogin(): Promise<{ sessionKey: string; qrcode: string; qrUrl: string; baseUrl: string }> {
  const sessionKey = crypto.randomUUID();
  const url = `${FIXED_BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=3`;
  const payload = await request(url, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ local_token_list: [] }),
  }, 20_000);
  const qrcode = String(payload.qrcode ?? '');
  const qrUrl = String(payload.qrcode_img_content ?? '');
  if (!qrcode || !qrUrl) throw new Error('WeChat did not return a QR code');
  return { sessionKey, qrcode, qrUrl, baseUrl: FIXED_BASE_URL };
}

export async function pollQrLogin(baseUrl: string, qrcode: string, verifyCode?: string, signal?: AbortSignal): Promise<any> {
  let endpoint = `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`;
  if (verifyCode) endpoint += `&verify_code=${encodeURIComponent(verifyCode)}`;
  try {
    return await request(`${baseUrl}/${endpoint}`, { method: 'GET', headers: commonHeaders() }, 15_000, signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) return { status: 'wait' };
    throw error;
  }
}

async function getUpdates(baseUrl: string, token: string, syncBuf: string, signal: AbortSignal): Promise<any> {
  try {
    return await request(`${baseUrl}/ilink/bot/getupdates`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ get_updates_buf: syncBuf, base_info: baseInfo() }),
    }, LONG_POLL_TIMEOUT, signal);
  } catch (error) {
    if (signal.aborted) throw error;
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) return { ret: 0, msgs: [], get_updates_buf: syncBuf };
    throw error;
  }
}

export async function sendWeixinText(baseUrl: string, token: string, to: string, text: string, contextToken?: string): Promise<{ messageId: string }> {
  const clientId = `dudu-${crypto.randomUUID()}`;
  const payload = await request(`${baseUrl}/ilink/bot/sendmessage`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      msg: {
        from_user_id: '',
        to_user_id: to,
        client_id: clientId,
        message_type: 2,
        message_state: 2,
        item_list: [{ type: 1, text_item: { text } }],
        ...(contextToken ? { context_token: contextToken } : {}),
      },
      base_info: baseInfo(),
    }),
  }, SEND_TIMEOUT);
  if (typeof payload.ret === 'number' && payload.ret !== 0) throw new Error(`WeChat send failed: ${payload.errmsg ?? payload.ret}`);
  return { messageId: String(payload.message_id ?? clientId) };
}

function messageText(message: WeixinMessage): string {
  for (const item of message.item_list ?? []) {
    if (item.type === 1 && item.text_item?.text) return item.text_item.text;
    if (item.type === 3 && item.voice_item?.text) return item.voice_item.text;
    if (item.type === 2) return '[图片]';
    if (item.type === 5) return '[视频]';
    if (item.type === 4) return '[文件]';
  }
  return '';
}

function messageId(message: WeixinMessage): string {
  if (message.message_id) return String(message.message_id);
  for (const item of message.item_list ?? []) if (item.msg_id) return String(item.msg_id);
  return '';
}

function chunkText(text: string): string[] {
  if (text.length <= CHUNK_SIZE) return [text];
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += CHUNK_SIZE) chunks.push(text.slice(index, index + CHUNK_SIZE));
  return chunks;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

export class WeixinService {
  private runtimes = new Map<string, Runtime>();
  private logins = new Map<string, LoginSession>();
  constructor(readonly registry: ConnectorRegistry, readonly store: Store, readonly root: string, readonly botExists: (botId: string) => boolean = () => true) {}

  private stateDir() { return join(this.root, '.dudu', 'weixin'); }
  private statePath(connectorId: string) { return join(this.stateDir(), `${connectorId}.json`); }
  private logPath(connectorId: string) { return join(this.stateDir(), `${connectorId}.jsonl`); }

  private state(connectorId: string): WeixinState {
    try { return JSON.parse(readFileSync(this.statePath(connectorId), 'utf8')) as WeixinState; } catch { return {}; }
  }

  private saveState(connectorId: string, state: WeixinState) {
    mkdirSync(this.stateDir(), { recursive: true });
    if (state.seen && state.seen.length > 2000) state.seen = state.seen.slice(-2000);
    const path = this.statePath(connectorId);
    const tmp = `${path}.${crypto.randomUUID()}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
    renameSync(tmp, path);
  }

  private log(connectorId: string, entry: Record<string, unknown>) {
    mkdirSync(this.stateDir(), { recursive: true });
    const path = this.logPath(connectorId);
    try {
      if (statSync(path).size > 1024 * 1024) {
        const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean).slice(-500);
        writeFileSync(path, lines.join('\n') + (lines.length ? '\n' : ''), { mode: 0o600 });
      }
    } catch { /* first write or unreadable log */ }
    try { writeFileSync(path, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n', { flag: 'a', mode: 0o600 }); } catch { /* message logging is best-effort */ }
  }

  private connector(connectorId: string): Connector {
    const connector = this.registry.get(connectorId);
    if (connector.provider !== 'weixin') throw new Error('Not a WeChat connector');
    return connector;
  }

  private runtime(connectorId: string): Runtime {
    let runtime = this.runtimes.get(connectorId);
    if (!runtime) {
      runtime = { abort: new AbortController(), running: false, state: 'logged_out' };
      this.runtimes.set(connectorId, runtime);
    }
    return runtime;
  }

  status(connectorId: string): WeixinStatus {
    const runtime = this.runtime(connectorId);
    const connector = this.registry.get(connectorId);
    return {
      connectorId,
      state: connector.credentials?.token ? runtime.state : 'logged_out',
      accountId: connector.credentials?.accountId,
      userId: connector.credentials?.userId,
      ...(runtime.error ? { error: runtime.error } : {}),
      ...(runtime.lastMessageAt ? { lastMessageAt: runtime.lastMessageAt } : {}),
    };
  }

  messages(connectorId: string, limit = 50): Array<Record<string, unknown>> {
    try {
      const count = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.round(limit))) : 50;
      const text = readFileSync(this.logPath(connectorId), 'utf8');
      return text.split('\n').filter(Boolean).slice(-count).map(line => { try { return JSON.parse(line); } catch { return { at: '', text: line }; } });
    } catch { return []; }
  }

  async start(): Promise<void> { this.sync(); }

  sync(): void {
    const wanted = new Set<string>();
    for (const connector of this.registry.list()) {
      if (connector.provider !== 'weixin') continue;
      const botId = typeof connector.settings?.botId === 'string' ? connector.settings.botId : '';
      if (!botId || !this.botExists(botId) || !connector.credentials?.token || !connector.credentials?.baseUrl) {
        this.stopConnector(connector.id);
        continue;
      }
      wanted.add(connector.id);
      const runtime = this.runtime(connector.id);
      if (!runtime.running) void this.run(connector.id, runtime);
    }
    for (const connectorId of [...this.runtimes.keys()]) if (!wanted.has(connectorId)) this.stopConnector(connectorId);
  }

  stopConnector(connectorId: string): void {
    const runtime = this.runtimes.get(connectorId);
    if (runtime) { runtime.abort.abort(); runtime.running = false; }
    this.runtimes.delete(connectorId);
    for (const [key, session] of this.logins) if (session.connectorId === connectorId) this.logins.delete(key);
  }

  async stop(): Promise<void> {
    for (const connectorId of [...this.runtimes.keys()]) this.stopConnector(connectorId);
  }

  remove(connectorId: string): void {
    this.stopConnector(connectorId);
    rmSync(this.statePath(connectorId), { force: true });
    rmSync(this.logPath(connectorId), { force: true });
  }

  async loginStart(connectorId?: string): Promise<{ sessionKey: string; qrUrl: string }> {
    if (connectorId) this.connector(connectorId);
    const session = await startQrLogin();
    this.logins.set(session.sessionKey, { ...(connectorId ? { connectorId } : {}), sessionKey: session.sessionKey, qrcode: session.qrcode, qrUrl: session.qrUrl, baseUrl: session.baseUrl, startedAt: Date.now() });
    for (const [key, value] of this.logins) if (Date.now() - value.startedAt > 5 * 60_000) this.logins.delete(key);
    return { sessionKey: session.sessionKey, qrUrl: session.qrUrl };
  }

  async loginPoll(connectorId: string | undefined, sessionKey: string, verifyCode?: string): Promise<{ state: string; message: string; needVerifyCode?: boolean; userId?: string; credentials?: Record<string, string> }> {
    const session = this.logins.get(sessionKey);
    if (!session || session.connectorId !== connectorId) throw new Error('Login session expired; start again');
    const payload = await pollQrLogin(session.baseUrl, session.qrcode, verifyCode);
    const status = String(payload.status ?? 'wait');
    if (status === 'scaned_but_redirect') {
      const host = String(payload.redirect_host ?? '').trim();
      if (host) session.baseUrl = `https://${host.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;
      return { state: 'scaned', message: '已扫码，正在切换登录节点' };
    }
    if (status === 'need_verifycode') return { state: 'need_verifycode', message: '请输入手机微信上显示的验证码', needVerifyCode: true };
    if (status === 'verify_code_blocked') return { state: 'need_verifycode', message: '验证码错误或尝试次数过多，请稍后再试', needVerifyCode: true };
    if (status === 'expired') {
      this.logins.delete(sessionKey);
      return { state: 'expired', message: '二维码已过期，请重新生成' };
    }
    if (status === 'binded_redirect') {
      if (!connectorId) throw new Error('该微信已绑定其他实例，请重新扫码');
      const connector = this.connector(connectorId);
      if (connector.credentials?.token) { this.sync(); return { state: 'connected', message: '该微信已连接' }; }
      throw new Error('该微信已绑定其他实例，当前连接没有拿到新的凭证');
    }
    if (status !== 'confirmed') return { state: status === 'scaned' ? 'scaned' : 'wait', message: status === 'scaned' ? '已扫码，请在手机上确认' : '等待扫码' };
    const token = String(payload.bot_token ?? '');
    const baseUrl = String(payload.baseurl ?? session.baseUrl).replace(/\/+$/, '');
    const accountId = String(payload.ilink_bot_id ?? '');
    const userId = String(payload.ilink_user_id ?? '');
    if (!token) throw new Error('WeChat confirmed the login but did not return a token');
    const credentials = { token, baseUrl: baseUrl || FIXED_BASE_URL, ...(accountId ? { accountId } : {}), ...(userId ? { userId } : {}) };
    this.logins.delete(sessionKey);
    if (!connectorId) return { state: 'connected', message: '微信已连接', ...(userId ? { userId } : {}), credentials };
    this.registry.setCredentials(connectorId, credentials);
    const runtime = this.runtime(connectorId);
    runtime.state = 'connected';
    runtime.error = undefined;
    runtime.accountId = accountId;
    runtime.userId = userId;
    this.sync();
    return { state: 'connected', message: '微信已连接', ...(userId ? { userId } : {}) };
  }

  async logout(connectorId: string): Promise<void> {
    this.stopConnector(connectorId);
    this.registry.setCredentials(connectorId, { token: '', baseUrl: '', accountId: '', userId: '' });
  }

  async sendText(connectorId: string, text: string, to?: string): Promise<{ ok: true; to: string; messageId: string }> {
    const connector = this.connector(connectorId);
    const botId = typeof connector.settings?.botId === 'string' ? connector.settings.botId : '';
    if (!botId) throw new Error('WeChat connector is not bound to a Bot');
    if (!this.botExists(botId)) throw new Error(`The bound Bot no longer exists: ${botId}`);
    const token = connector.credentials?.token;
    const baseUrl = connector.credentials?.baseUrl;
    if (!token || !baseUrl) throw new Error('WeChat is not connected. Open the connector and scan the login QR code.');
    const state = this.state(connectorId);
    const peer = to?.trim() || state.lastPeer;
    if (!peer) throw new Error('No WeChat recipient yet. Wait for an inbound message or pass a target.');
    const content = text.trim();
    if (!content) throw new Error('text is required');
    const contextToken = state.peers?.[peer]?.contextToken;
    let last = '';
    for (const chunk of chunkText(content)) last = (await sendWeixinText(baseUrl, token, peer, chunk, contextToken)).messageId;
    this.store.message(botId, 'default', botId, content, 'sent');
    this.log(connectorId, { direction: 'out', peer, text: content, messageId: last });
    return { ok: true, to: peer, messageId: last };
  }

  private async run(connectorId: string, runtime: Runtime): Promise<void> {
    runtime.running = true;
    runtime.state = 'connecting';
    runtime.error = undefined;
    const connector = this.registry.get(connectorId);
    const token = connector.credentials?.token;
    const baseUrl = connector.credentials?.baseUrl;
    if (!token || !baseUrl) { runtime.running = false; runtime.state = 'logged_out'; return; }
    const state = this.state(connectorId);
    let failures = 0;
    while (!runtime.abort.signal.aborted) {
      try {
        const response = await getUpdates(baseUrl, token, state.syncBuf ?? '', runtime.abort.signal);
        if (runtime.abort.signal.aborted) break;
        if (typeof response.get_updates_buf === 'string' && response.get_updates_buf) {
          state.syncBuf = response.get_updates_buf;
          this.saveState(connectorId, state);
        }
        const ret = Number(response.ret ?? 0);
        const errcode = Number(response.errcode ?? 0);
        if ((Number.isFinite(ret) && ret !== 0) || (Number.isFinite(errcode) && errcode !== 0)) {
          if (ret === -14 || errcode === -14) {
            runtime.state = 'error';
            runtime.error = '微信登录已失效，请重新扫码登录';
            break;
          }
          throw new Error(`WeChat getupdates failed: ${response.errmsg ?? String(ret || errcode)}`);
        }
        failures = 0;
        runtime.state = 'connected';
        runtime.error = undefined;
        for (const message of Array.isArray(response.msgs) ? response.msgs as WeixinMessage[] : []) this.receive(connectorId, message, state);
        this.saveState(connectorId, state);
      } catch (error) {
        if (runtime.abort.signal.aborted) break;
        failures++;
        runtime.state = 'error';
        runtime.error = error instanceof Error ? error.message : String(error);
        await sleep(failures >= 3 ? 30_000 : 2_000, runtime.abort.signal);
        if (failures >= 3) failures = 0;
      }
    }
    runtime.running = false;
  }

  private receive(connectorId: string, message: WeixinMessage, state: WeixinState) {
    if (message.message_type === 2) return;
    const from = String(message.from_user_id ?? '');
    const id = messageId(message);
    if (!from || !id) return;
    const text = messageText(message);
    if (!text) return;
    if (state.seen?.includes(id)) return;
    state.seen = [...(state.seen ?? []), id];
    state.lastPeer = from;
    state.peers = { ...(state.peers ?? {}), [from]: { peer: from, lastAt: new Date().toISOString(), ...(message.context_token ? { contextToken: message.context_token } : {}), ...(state.peers?.[from]?.name ? { name: state.peers[from]!.name } : {}) } };
    const connector = this.registry.get(connectorId);
    const botId = typeof connector.settings?.botId === 'string' ? connector.settings.botId : '';
    if (!botId || !this.botExists(botId)) return;
    this.store.message(botId, 'default', 'user', text, 'sent');
    this.log(connectorId, { direction: 'in', peer: from, text, messageId: id });
    const runtime = this.runtime(connectorId);
    runtime.lastMessageAt = new Date().toISOString();
    this.store.publish({
      botId,
      sourceId: `weixin:${connectorId}`,
      type: 'message.weixin',
      payload: {
        text,
        from,
        fromName: from,
        peer: from,
        connectorId,
        messageId: id,
        externalReply: { tool: `${connectorId}__send_text`, arguments: { to: from } },
      },
      dedupeKey: `weixin:${id}`,
      delivery: 'wake',
    });
  }
}
