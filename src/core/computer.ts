import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DesktopConfig, DesktopStatus } from '../contracts';
import { BotdSupervisor } from '../botd/supervisor';
import { BotdError } from '../botd/types';
import type { ConfigStore } from './config';
import type { Store } from './store';
import { botdRoot } from './workspace';

export interface ComputerTarget { desktopId: string; width: number; height: number; watchUrl?: string }

/** ConfigStore normalizes every computer field when it reads a Bot. */
export function resolveComputerTarget(config: ConfigStore, botId: string): ComputerTarget {
  const { desktopId, width, height, watchUrl } = config.bot(botId).computer;
  return { desktopId: desktopId!, width: width!, height: height!, watchUrl };
}

/**
 * Owns the workspace's desktop sessions. The supervisor runs in-process, so the
 * agent tools, the web UI and the live proxy share one code path. Xvfb, Xfce,
 * voxl and the X11 helper commands remain external processes.
 */
export class Computer {
  readonly supervisor: BotdSupervisor;
  constructor(public config: ConfigStore, public store: Store, supervisor?: BotdSupervisor) {
    this.supervisor = supervisor ?? new BotdSupervisor({ root: botdRoot(config.root) });
  }

  target(botId: string) { return resolveComputerTarget(this.config, botId); }

  async desktops(): Promise<DesktopStatus[]> {
    try { return await this.supervisor.list(); } catch { return []; }
  }

  /** cua-aligned tool surface, called in-process by the agent. */
  async cua(botId: string, method: string, args: Record<string, any> = {}, signal?: AbortSignal): Promise<unknown> {
    signal?.throwIfAborted();
    const target = this.target(botId);
    const d = target.desktopId;
    // Lifecycle tools are the admin plane exposed as agent tools.
    if (method === 'start' || method === 'stop' || method === 'status') return this.call(botId, method, args, signal);
    // Lazy start: the first computer-use tool brings a stopped desktop up.
    await this.ensureDesktop(botId, target, signal);
    const s = this.supervisor;
    switch (method) {
      case 'screenshot': {
        const bytes = await s.screenshot(d, args);
        const format = (args.format as string) ?? 'png';
        return { mimeType: `image/${format === 'jpeg' ? 'jpeg' : format}`, base64: Buffer.from(bytes).toString('base64') };
      }
      case 'screen_size': return s.screen_size(d);
      case 'displays': return s.displays(d);
      case 'click': await s.click(d, { x: args.x, y: args.y, button: { left: 1, middle: 2, right: 3 }[args.button as string] ?? 1 }); return { ok: true };
      case 'double_click': await s.double_click(d, args.x, args.y); return { ok: true };
      case 'right_click': await s.right_click(d, args.x, args.y); return { ok: true };
      case 'move': await s.move(d, args.x, args.y); return { ok: true };
      case 'drag': await s.drag(d, args.start_x, args.start_y, args.end_x, args.end_y, args.button); return { ok: true };
      case 'scroll': await s.scrollAt(d, args.x ?? 0, args.y ?? 0, args.scroll_x ?? 0, args.scroll_y ?? 3); return { ok: true };
      case 'mouse_down': await s.mouse_down(d, args.button); return { ok: true };
      case 'mouse_up': await s.mouse_up(d, args.button); return { ok: true };
      case 'key_down': await s.key_down(d, args.key); return { ok: true };
      case 'key_up': await s.key_up(d, args.key); return { ok: true };
      case 'keypress': await s.keypress(d, args.keys ?? args.key); return { ok: true };
      case 'type': await s.type(d, args.text); return { ok: true };
      case 'cursor_position': return s.cursor_position(d);
      case 'clipboard_get': return { text: await s.clipboard_get(d) };
      case 'clipboard_set': await s.clipboard_set(d, args.text); return { ok: true };
      case 'run': return s.run(d, args as any);
      case 'process_list': return s.process_list(d);
      case 'process_read': return s.process_read(d, args.pid);
      case 'process_kill': return s.process_kill(d, args.pid);
      case 'terminal_create': return s.terminal_create(d, args);
      case 'terminal_send': await s.terminal_send(d, args.pid, args.data); return { ok: true };
      case 'terminal_read': return { output: await s.terminal_read(d, args.pid) };
      case 'terminal_info': return s.terminal_info(d, args.pid);
      case 'terminal_close': await s.terminal_close(d, args.pid); return { ok: true };
      case 'window_list': return s.window_list(d);
      case 'window_active_title': return { title: await s.window_active_title(d) };
      case 'window_activate': await s.window_activate(d, args.window_id ?? args.id); return { ok: true };
      case 'files_read_text': return { content: await s.files_read_text(d, args.path) };
      case 'files_write_text': await s.files_write_text(d, args.path, args.content); return { ok: true };
      case 'files_read_bytes': return { data_base64: Buffer.from(await s.files_read_bytes(d, args.path, args.offset, args.length)).toString('base64') };
      case 'files_write_bytes': await s.files_write_bytes(d, args.path, new Uint8Array(Buffer.from(String(args.data_base64 ?? ''), 'base64'))); return { ok: true };
      case 'files_list': return s.files_list(d, args.path);
      case 'files_make_dir': await s.files_make_dir(d, args.path); return { ok: true };
      case 'files_remove': await s.files_remove(d, args.path); return { ok: true };
      case 'files_remove_dir': await s.files_remove_dir(d, args.path); return { ok: true };
      case 'files_exists': return s.files_exists(d, args.path);
      case 'files_is_dir': return s.files_is_dir(d, args.path);
      case 'files_size': return s.files_size(d, args.path);
      default: throw new Error(`Unknown computer tool: ${method}`);
    }
  }

  /** Admin/lifecycle plane used by the web UI and the live-view proxy. */
  async call(botId: string, action: string, args: Record<string, any> = {}, signal?: AbortSignal): Promise<any> {
    signal?.throwIfAborted();
    const target = this.target(botId);
    const { desktopId, width, height, watchUrl } = target;
    const s = this.supervisor;
    if (action === 'takeover') {
      this.store.publish({ botId, sourceId: 'computer', type: 'computer.takeover', payload: { requestedAt: new Date().toISOString() }, delivery: 'digest' });
      return { status: 'requested', ...(await this.call(botId, 'watch', {}, signal)) };
    }
    if (action === 'start') {
      const current = await this.desktopState(desktopId);
      if (current?.state === 'ready') return current;
      if (current?.state === 'starting') return this.waitReady(desktopId, signal);
      const config: DesktopConfig = { id: desktopId, botId, width, height };
      const result = await s.start(config);
      this.store.publish({ botId, sourceId: 'computer', type: 'computer.started', payload: { desktopId, state: result.state, port: result.port }, delivery: 'ignore' });
      return result;
    }
    if (action === 'stop') {
      if (!await this.desktopState(desktopId)) return { id: desktopId, botId, width, height, state: 'stopped' };
      const result = await s.stop(desktopId);
      this.store.publish({ botId, sourceId: 'computer', type: 'computer.stopped', payload: { desktopId, state: result.state, port: result.port }, delivery: 'ignore' });
      return result;
    }
    if (action === 'restart') {
      if (!await this.desktopState(desktopId)) return this.call(botId, 'start', {}, signal);
      await s.stop(desktopId);
      return this.call(botId, 'start', {}, signal);
    }
    if (action === 'status') {
      try { return await s.get(desktopId); }
      catch (error) { if (error instanceof BotdError && error.status === 404) return { id: desktopId, botId, width, height, state: 'stopped' }; throw error; }
    }
    if (action === 'shot') {
      const bytes = await s.shot(desktopId);
      const dir = join(this.config.botPath(botId), 'artifacts'); mkdirSync(dir, { recursive: true });
      const path = join(dir, `computer-${Date.now()}.png`); await Bun.write(path, bytes);
      return { path, url: `/api/artifacts/${botId}/${path.split('/').pop()}`, mimeType: 'image/png', base64: Buffer.from(bytes).toString('base64') };
    }
    if (action === 'watch') {
      const result = await s.watch(desktopId);
      if (watchUrl) result.url = watchUrl;
      return result;
    }
    if (action === 'recordStart') return s.recordStart(desktopId, args);
    if (action === 'recordStop') return s.recordStop(desktopId);
    throw new Error(`Unknown computer action: ${action}`);
  }

  private async desktopState(desktopId: string): Promise<DesktopStatus | undefined> {
    try { return await this.supervisor.get(desktopId); }
    catch (error) { if (error instanceof BotdError && error.status === 404) return undefined; throw error; }
  }

  private async waitReady(desktopId: string, signal?: AbortSignal, timeoutMs = 60_000): Promise<DesktopStatus> {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      await new Promise(resolve => setTimeout(resolve, 200));
      signal?.throwIfAborted();
      const status = await this.supervisor.get(desktopId);
      if (status.state === 'ready') return status;
      if (status.state !== 'starting') throw new Error(`Desktop ${desktopId} is ${status.state}${status.error ? `: ${status.error}` : ''}`);
    }
    throw new Error(`Desktop ${desktopId} did not become ready in ${timeoutMs}ms`);
  }

  /** Start a stopped desktop before the first computer-use call. */
  private async ensureDesktop(botId: string, target: ComputerTarget, signal?: AbortSignal): Promise<void> {
    const status = await this.desktopState(target.desktopId);
    if (status?.state === 'ready') return;
    if (status?.state === 'starting') { await this.waitReady(target.desktopId, signal); return; }
    if (status?.state === 'error') throw new Error(`Desktop ${target.desktopId} is in error: ${status.error ?? 'unknown'}`);
    await this.call(botId, 'start', {}, signal);
  }

  /** Start every Bot desktop when auto-start is enabled. */
  async startConfigured(): Promise<void> {
    if (this.config.global().autoStartComputers === false) return;
    for (const bot of this.config.bots()) {
      await this.call(bot.id, 'start').catch(error => this.store.publish({
        botId: bot.id, sourceId: 'computer', type: 'computer.error',
        payload: { error: String(error) }, delivery: 'digest',
      }));
    }
  }

  close() { return this.supervisor.close(); }
}
