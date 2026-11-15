import type { Database } from 'bun:sqlite';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CronExpressionParser } from 'cron-parser';
import { eventInput, id, object, text, type EventInput, type SourceConfig } from '../contracts';
import { argv, minimalEnv, stringMap } from '../connectors';

interface Cursor { nextAt?: number; completed?: boolean; failures?: number }
interface RunningProcess { child: ChildProcess; done: Promise<void>; stopping: boolean; fault?: boolean }
export function validateSource(value: unknown): SourceConfig {
  const v = object(value); id(v.id); id(v.botId);
  if (!['once','interval','cron','process','webhook'].includes(v.kind)) throw new Error('Invalid source kind');
  if (typeof v.enabled !== 'boolean') throw new Error('enabled must be boolean');
  if (!['high','normal','low'].includes(v.priority)) throw new Error('Invalid priority');
  if (v.type !== undefined) text(v.type, 'type');
  if (v.env !== undefined) stringMap(v.env);
  if (v.kind === 'once' && (!v.at || !Number.isFinite(Date.parse(v.at)))) throw new Error('once requires valid at');
  if (v.kind === 'interval' && (!Number.isSafeInteger(v.intervalMs) || v.intervalMs < 10)) throw new Error('intervalMs must be an integer >= 10');
  if (v.kind === 'cron') CronExpressionParser.parse(text(v.cron, 'cron'), { tz: v.timezone });
  if (v.kind === 'process') argv(v.argv);
  return structuredClone(v) as SourceConfig;
}
/** JSON files are source truth. SQLite contains only runtime cursors and bounded logs. */
export class SourceManager {
  private timer?: ReturnType<typeof setInterval>;
  private ticking?: Promise<void>;
  private active = false;
  private processes = new Map<string, RunningProcess>();
  constructor(readonly root: string, readonly db: Database, readonly submit: (event: EventInput) => unknown | Promise<unknown>) {
    db.exec(`CREATE TABLE IF NOT EXISTS source_cursors (source_id TEXT PRIMARY KEY, cursor_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS source_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, source_id TEXT NOT NULL, at TEXT NOT NULL, level TEXT NOT NULL, message TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS source_runs_source ON source_runs(source_id,id);`);
  }
  private path(botId: string, sourceId: string) { return join(this.root, 'bots', id(botId), 'sources', `${id(sourceId)}.json`); }
  list(botId?: string): SourceConfig[] {
    const bots = botId ? [id(botId)] : this.dirs(join(this.root, 'bots'));
    const result: SourceConfig[] = []; const seen = new Set<string>();
    for (const bot of bots) {
      const dir = join(this.root, 'bots', bot, 'sources');
      let files: string[]; try { files = readdirSync(dir).filter(f => f.endsWith('.json')); } catch (error: any) { if (error.code === 'ENOENT') continue; throw error; }
      for (const file of files) {
        const source = validateSource(JSON.parse(readFileSync(join(dir, file), 'utf8')));
        if (source.botId !== bot || file !== `${source.id}.json`) throw new Error('Source file identity mismatch');
        if (seen.has(source.id)) throw new Error(`Source ID must be globally unique: ${source.id}`); seen.add(source.id); result.push(source);
      }
    }
    return result.sort((a,b) => a.id.localeCompare(b.id));
  }
  private dirs(path: string): string[] { try { return readdirSync(path, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); } catch (error: any) { if (error.code === 'ENOENT') return []; throw error; } }
  get(sourceId: string) { id(sourceId); const source = this.list().find(s => s.id === sourceId); if (!source) throw new Error(`Unknown source: ${sourceId}`); return source; }
  private configChanged(source: SourceConfig, action: string) {
    try { const result = this.submit({ botId: source.botId, sourceId: 'source:config', type: 'source.changed', payload: { action, sourceId: source.id, enabled: source.enabled, kind: source.kind, type: source.type }, delivery: 'digest' }); if (result instanceof Promise) void result.catch(error => this.log(source.id, 'error', `config event failed: ${error}`)); }
    catch (error) { this.log(source.id, 'error', `config event failed: ${error}`); }
  }
  register(value: SourceConfig): SourceConfig {
    const source = validateSource(value); const previous = this.list().find(s => s.id === source.id);
    if (previous && previous.botId !== source.botId) throw new Error(`Source ID must be globally unique: ${source.id}`);
    this.kill(source.id); const path = this.path(source.botId, source.id); mkdirSync(join(this.root, 'bots', source.botId, 'sources'), { recursive: true });
    const tmp = `${path}.${crypto.randomUUID()}.tmp`; writeFileSync(tmp, JSON.stringify(source, null, 2) + '\n', { mode: 0o600 }); renameSync(tmp, path);
    this.setCursor(source.id, this.initial(source, Date.now())); this.configChanged(source, 'saved'); return source;
  }
  enable(sourceId: string, enabled: boolean): SourceConfig {
    if (typeof enabled !== 'boolean') throw new Error('enabled must be boolean');
    const source = this.get(sourceId); source.enabled = enabled;
    const path = this.path(source.botId, source.id); const tmp = `${path}.${crypto.randomUUID()}.tmp`;
    writeFileSync(tmp, JSON.stringify(source, null, 2) + '\n', { mode: 0o600 }); renameSync(tmp, path);
    if (!enabled) this.kill(sourceId); this.configChanged(source, enabled ? 'enabled' : 'disabled'); return source;
  }
  remove(sourceId: string): void {
    const source = this.get(sourceId); this.kill(sourceId); rmSync(this.path(source.botId, source.id));
    this.db.query('DELETE FROM source_cursors WHERE source_id=?').run(sourceId); this.configChanged(source, 'removed');
  }
  getCursor(sourceId: string): Cursor | undefined {
    const row = this.db.query('SELECT cursor_json FROM source_cursors WHERE source_id=?').get(id(sourceId)) as { cursor_json: string } | null;
    return row ? JSON.parse(row.cursor_json) : undefined;
  }
  setCursor(sourceId: string, cursor: Cursor): void { this.db.query('INSERT INTO source_cursors(source_id,cursor_json) VALUES (?,?) ON CONFLICT(source_id) DO UPDATE SET cursor_json=excluded.cursor_json').run(id(sourceId), JSON.stringify(cursor)); }
  log(sourceId: string, level: string, message: string): void {
    this.db.query('INSERT INTO source_runs(source_id,at,level,message) VALUES (?,?,?,?)').run(sourceId, new Date().toISOString(), level, message.slice(0,8192));
    this.db.query('DELETE FROM source_runs WHERE source_id=? AND id NOT IN (SELECT id FROM source_runs WHERE source_id=? ORDER BY id DESC LIMIT 200)').run(sourceId, sourceId);
  }
  private initial(source: SourceConfig, now: number): Cursor {
    if (source.kind === 'once') return { nextAt: Date.parse(source.at!) };
    if (source.kind === 'interval') return { nextAt: now + source.intervalMs! };
    if (source.kind === 'cron') return { nextAt: this.nextCron(source, now) };
    return {};
  }
  private nextCron(source: SourceConfig, now: number): number { return CronExpressionParser.parse(source.cron!, { currentDate: new Date(now), tz: source.timezone }).next().getTime(); }
  async trigger(sourceId: string, payload?: unknown): Promise<unknown> {
    const source = this.get(sourceId); if (!source.enabled) throw new Error('Source disabled');
    return this.deliver(source, payload === undefined ? source.payload : payload);
  }
  private async deliver(source: SourceConfig, payload: unknown, fields: Record<string, unknown> = {}): Promise<unknown> {
    const event = eventInput({ ...fields, botId: source.botId, sourceId: source.id, priority: source.priority, type: typeof fields.type === 'string' ? fields.type : source.type ?? `source.${source.kind}`, payload });
    try { const result = await this.submit(event); this.log(source.id, 'info', 'event submitted'); return result; }
    catch (error) { this.log(source.id, 'error', String(error)); throw error; }
  }
  /** Missed intervals/cron ticks coalesce into one event; nextAt advances before dispatch. */
  tick(now = Date.now()): Promise<void> {
    if (this.ticking) return this.ticking;
    this.ticking = this.runTick(now).finally(() => { this.ticking = undefined; }); return this.ticking;
  }
  private async runTick(now: number): Promise<void> {
    for (const source of this.list()) {
      if (!source.enabled) { this.kill(source.id); continue; }
      let cursor = this.getCursor(source.id); if (!cursor) { cursor = this.initial(source, now); this.setCursor(source.id, cursor); }
      if (source.kind === 'process') { if (this.active && !this.processes.has(source.id) && (cursor.nextAt ?? 0) <= now) this.launch(source); continue; }
      if (source.kind === 'webhook' || cursor.completed || (cursor.nextAt ?? Infinity) > now) continue;
      this.setCursor(source.id, source.kind === 'once' ? { completed: true } : { nextAt: source.kind === 'interval' ? now + source.intervalMs! : this.nextCron(source, now) });
      try { await this.deliver(source, source.payload); } catch { /* error logged; never replay a backlog forever */ }
    }
  }
  start(pollMs = 250): void {
    if (this.active) return;
    if (!Number.isFinite(pollMs) || pollMs < 10) throw new Error('Invalid pollMs');
    this.active = true;
    const poll = () => { void this.tick().catch(error => { console.error('SourceManager tick:', error); }); };
    this.timer = setInterval(poll, pollMs); this.timer.unref(); poll();
  }
  async stop(): Promise<void> {
    this.active = false; if (this.timer) clearInterval(this.timer); this.timer = undefined;
    const running = [...this.processes.values()]; for (const sourceId of this.processes.keys()) this.kill(sourceId);
    await Promise.all(running.map(p => p.done)); await this.ticking;
  }
  private kill(sourceId: string, fault = false) {
    const running = this.processes.get(sourceId); if (!running) return; running.stopping = true; running.fault = fault;
    try { if (process.platform !== 'win32' && running.child.pid) process.kill(-running.child.pid, 'SIGKILL'); else running.child.kill('SIGKILL'); } catch {}
  }
  private launch(source: SourceConfig): void {
    const child = spawn(source.argv![0], source.argv!.slice(1), { stdio: ['ignore','pipe','pipe'], env: minimalEnv(source.env), detached: process.platform !== 'win32' });
    let finish!: () => void; const done = new Promise<void>(resolve => { finish = resolve; });
    const running: RunningProcess = { child, done, stopping: false }; this.processes.set(source.id, running);
    let buffer = ''; let stderr = ''; let pending = Promise.resolve(); let pendingCount = 0; let received = false; const startedAt = Date.now();
    const line = (value: string) => {
      if (!value.trim() || running.stopping) return;
      if (++pendingCount > 256) { this.log(source.id, 'error', 'process event queue limit exceeded'); this.kill(source.id, true); return; }
      pending = pending.then(async () => {
        if (running.stopping) return;
        try {
          const item = object(JSON.parse(value)); received = true;
          await this.deliver(source, 'payload' in item ? item.payload : item, item);
        } catch (error) { this.log(source.id, 'error', `Invalid process event or submit failed: ${error}`); }
      }).finally(() => { pendingCount--; });
    };
    child.stdout!.on('data', (chunk: Buffer) => {
      buffer += chunk.toString(); let index: number;
      while ((index = buffer.indexOf('\n')) >= 0) { const value = buffer.slice(0,index); buffer = buffer.slice(index+1); if (Buffer.byteLength(value) > 1024*1024) { this.log(source.id,'error','process line limit exceeded'); this.kill(source.id, true); return; } line(value); }
      if (Buffer.byteLength(buffer) > 1024*1024) { this.log(source.id,'error','process line limit exceeded'); this.kill(source.id, true); }
    });
    child.stderr!.on('data', (chunk: Buffer) => { stderr += chunk.toString(); let index: number; while ((index = stderr.indexOf('\n')) >= 0) { this.log(source.id, 'stderr', stderr.slice(0,index)); stderr = stderr.slice(index+1); } if (stderr.length > 8192) { this.log(source.id,'stderr',stderr); stderr = ''; } });
    child.on('error', error => this.log(source.id,'error',String(error)));
    child.on('close', code => {
      if (buffer.trim()) line(buffer); if (stderr) this.log(source.id,'stderr',stderr);
      void pending.finally(() => {
        if (!running.stopping || running.fault) {
          const previous = this.getCursor(source.id) ?? {};
          const failures = received && Date.now()-startedAt > 30_000 ? 0 : Math.min((previous.failures ?? 0)+1, 16);
          const delay = Math.min(60_000, 500 * 2 ** failures);
          this.setCursor(source.id, { failures, nextAt: Date.now()+delay });
          this.log(source.id,'exit',`code=${code}; restart in ${delay}ms`);
        }
        if (this.processes.get(source.id) === running) this.processes.delete(source.id); finish();
      });
    });
  }
}
