import type { AppState } from './types';
import type { ProviderConfig, UploadedWorkspaceFile, WorkspaceEntry } from '../../contracts';

const TOKEN_KEY = 'dudu.token';

export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = 'ApiError'; }
}

export const savedToken = (): string => { try { return localStorage.getItem(TOKEN_KEY) ?? ''; } catch { return ''; } };
export const storeToken = (token: string) => { try { token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY); } catch { /* 私密模式等场景忽略 */ } };

function headers(token: string, json = false): Headers {
  const result = new Headers();
  if (token) result.set('Authorization', `Bearer ${token}`);
  if (json) result.set('Content-Type', 'application/json');
  return result;
}

async function checked(response: Response): Promise<Response> {
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new ApiError(response.status, `HTTP ${response.status}: ${detail || response.statusText}`);
  }
  return response;
}

export async function authStatus(): Promise<boolean> {
  const response = await checked(await fetch('/api/auth/status'));
  return (await response.json() as { authRequired: boolean }).authRequired;
}

export function loginWithPassword(password: string): Promise<string> {
  return request<{ token: string }>('', '/auth/login', 'POST', { password }).then(result => result.token);
}

export async function request<T>(token: string, path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await checked(await fetch(`/api${path}`, {
    method, headers: headers(token, body !== undefined), body: body === undefined ? undefined : JSON.stringify(body), signal,
  }));
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!text) return undefined as T;
  try { return JSON.parse(text) as T; } catch { throw new ApiError(response.status, `API 未返回有效 JSON (${path})`); }
}

/** 二进制请求（电脑截图等），返回 Blob。 */
export async function fetchBlob(token: string, path: string, signal?: AbortSignal): Promise<Blob> {
  const response = await checked(await fetch(`/api${path}`, { headers: headers(token), signal }));
  return response.blob();
}

export function parseJson<T>(text: string): T {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('请输入 JSON 对象。');
  return value as T;
}
export function parseJsonArray<T>(text: string): T[] {
  const value: unknown = JSON.parse(text);
  if (!Array.isArray(value)) throw new Error('请输入 JSON 数组。');
  return value as T[];
}
export const pretty = (value: unknown) => JSON.stringify(value, null, 2);
export const segment = encodeURIComponent;
export const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

function isAppState(value: unknown): value is AppState {
  if (!value || typeof value !== 'object') return false;
  if (typeof (value as { setupCompleted?: unknown }).setupCompleted !== 'boolean') return false;
  return ['bots', 'connectors', 'sources', 'providers', 'statuses', 'messages', 'desktops']
    .every(key => Array.isArray((value as Record<string, unknown>)[key]));
}

/** 订阅 SSE：任意事件触发一次快照刷新（含 100ms 去抖），连接成功/断开回调。 */
export async function streamEvents(token: string, signal: AbortSignal, onChange: () => void, onConnected: () => void): Promise<void> {
  const response = await checked(await fetch('/api/stream', { headers: headers(token), signal }));
  if (!response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('实时接口未返回 text/event-stream。');
  if (!response.body) throw new Error('浏览器未提供流读取器。');
  onConnected();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) throw new Error('实时连接已关闭。');
      pending += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      let end: number;
      while ((end = pending.indexOf('\n\n')) !== -1) {
        const event = pending.slice(0, end);
        pending = pending.slice(end + 2);
        if (event.split('\n').some(line => line.startsWith('data:'))) onChange();
      }
      if (pending.length > 1_000_000) throw new Error('实时消息超过读取限制。');
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export async function loadState(token: string, signal?: AbortSignal): Promise<AppState> {
  const state = await request<unknown>(token, '/state', 'GET', undefined, signal);
  if (!isAppState(state)) throw new Error('状态响应结构不完整');
  return state;
}

async function uploadForm(token: string, path: string, files: File[]): Promise<UploadedWorkspaceFile[]> {
  const form = new FormData();
  for (const file of files) form.append('files', file);
  const response = await checked(await fetch(`/api${path}`, { method: 'POST', headers: headers(token), body: form }));
  return (await response.json() as { files: UploadedWorkspaceFile[] }).files;
}

/** Upload composer files into the Bot's work/uploads directory. */
export function uploadComposerFiles(token: string, botId: string, files: File[]): Promise<UploadedWorkspaceFile[]> {
  return uploadForm(token, `/bots/${segment(botId)}/uploads`, files);
}

export async function listWorkspace(token: string, botId: string, path: string): Promise<WorkspaceEntry[]> {
  const query = new URLSearchParams({ path });
  const result = await request<{ entries: WorkspaceEntry[] }>(token, `/bots/${segment(botId)}/files?${query}`);
  return result.entries;
}

export function uploadWorkspaceFiles(token: string, botId: string, path: string, files: File[]): Promise<UploadedWorkspaceFile[]> {
  const query = new URLSearchParams({ path });
  return uploadForm(token, `/bots/${segment(botId)}/files?${query}`, files);
}

export async function deleteWorkspacePath(token: string, botId: string, path: string, recursive = false): Promise<void> {
  const query = new URLSearchParams({ path, ...(recursive ? { recursive: '1' } : {}) });
  await request(token, `/bots/${segment(botId)}/files?${query}`, 'DELETE');
}

export async function mkdirWorkspacePath(token: string, botId: string, path: string): Promise<void> {
  await request(token, `/bots/${segment(botId)}/files/mkdir`, 'POST', { path });
}

export function workspaceBlob(token: string, botId: string, path: string, signal?: AbortSignal): Promise<Blob> {
  return fetchBlob(token, `/bots/${segment(botId)}/file?${new URLSearchParams({ path })}`, signal);
}

export function saveAdvancedMode(token: string, advancedMode: boolean): Promise<boolean> {
  return request<{ advancedMode: boolean }>(token, '/advanced-settings', 'PUT', { advancedMode }).then(result => result.advancedMode);
}

export type DiscoveredModel = { id: string; name: string };
export type ProviderConnection = Pick<ProviderConfig, 'api' | 'baseUrl' | 'apiKey'>;

export async function discoverProviderModels(token: string, connection: ProviderConnection, signal?: AbortSignal): Promise<DiscoveredModel[]> {
  const result = await request<{ models: DiscoveredModel[] }>(token, '/providers/models', 'POST', connection, signal);
  return result.models;
}

export function completeSetup(token: string): Promise<boolean> {
  return request<{ setupCompleted: boolean }>(token, '/setup', 'PUT', { completed: true }).then(result => result.setupCompleted);
}

export type SessionHistoryPage = { entries: unknown[]; cursor: number; hasMore: boolean };

export type SessionFrame =
  | { kind: 'history'; entries: unknown[]; cursor: number; hasMore: boolean }
  | { kind: 'agent'; event: unknown; at: string }
  | { kind: 'error'; error: string };

export function sessionHistory(token: string, botId: string, before: number, signal?: AbortSignal): Promise<SessionHistoryPage> {
  return request<SessionHistoryPage>(token, `/bots/${segment(botId)}/session/history?before=${before}`, 'GET', undefined, signal);
}

/** Stream a Bot's agent session. Uses fetch so the Authorization header stays available. */
export async function streamSession(token: string, botId: string, signal: AbortSignal, onFrame: (frame: SessionFrame) => void, onConnected: () => void): Promise<void> {
  const response = await checked(await fetch(`/api/bots/${segment(botId)}/session/stream`, { headers: headers(token), signal }));
  if (!response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('会话接口未返回 text/event-stream。');
  if (!response.body) throw new Error('浏览器未提供流读取器。');
  onConnected();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) throw new Error('会话实时连接已关闭。');
      pending += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      let end: number;
      while ((end = pending.indexOf('\n\n')) !== -1) {
        const block = pending.slice(0, end);
        pending = pending.slice(end + 2);
        const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (!data) continue;
        try { onFrame(JSON.parse(data) as SessionFrame); } catch { /* ignore malformed frames */ }
      }
      if (pending.length > 2_000_000) throw new Error('会话实时消息超过读取限制。');
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
