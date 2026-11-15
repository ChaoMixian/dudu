import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, chmod, rm, realpath, lstat, readdir } from 'node:fs/promises';
import { join, resolve, dirname, sep, isAbsolute } from 'node:path';
import { id as validId } from '../contracts';
import { BotdError, DEFAULT_ROOT, type BotdOptions, type DesktopConfig, type DesktopStatus, type SavedDesktop, type ProcessRecord, type ExecOptions, type ExecResult, type WatchInfo, type RecordingInfo } from './types';

const BINARIES = ['Xvfb','xfce4-session','xfwm4','xfce4-panel','xfdesktop','xauth','xdpyinfo','xprop','xdotool','xclip','ffmpeg','dbus-daemon','voxl'] as const;
const PNG = Buffer.from([137,80,78,71,13,10,26,10]);
// xfce4-session starts ssh/gpg agents itself. GnuPG keeps its agent socket in
// /run/user/<uid>, so that startup step talks to the host's agent and blocks
// the whole session when that agent is busy.
// The Failsafe list drops Thunar (it daemonizes without reporting startup
// completion) and starts the panel and desktop in one group.
const SESSION_XML = `<?xml version="1.0" encoding="UTF-8"?>
<channel name="xfce4-session" version="1.0">
  <property name="startup" type="empty">
    <property name="gpg-agent" type="empty">
      <property name="enabled" type="bool" value="false"/>
    </property>
    <property name="ssh-agent" type="empty">
      <property name="enabled" type="bool" value="false"/>
    </property>
  </property>
  <property name="sessions" type="empty">
    <property name="Failsafe" type="empty">
      <property name="IsFailsafe" type="bool" value="true"/>
      <property name="Count" type="int" value="4"/>
      <property name="Client0_Command" type="array"><value type="string" value="xfwm4"/></property>
      <property name="Client0_Priority" type="int" value="15"/>
      <property name="Client0_PerScreen" type="bool" value="false"/>
      <property name="Client1_Command" type="array"><value type="string" value="xfsettingsd"/></property>
      <property name="Client1_Priority" type="int" value="20"/>
      <property name="Client1_PerScreen" type="bool" value="false"/>
      <property name="Client2_Command" type="array"><value type="string" value="xfce4-panel"/></property>
      <property name="Client2_Priority" type="int" value="25"/>
      <property name="Client2_PerScreen" type="bool" value="false"/>
      <property name="Client3_Command" type="array"><value type="string" value="xfdesktop"/></property>
      <property name="Client3_Priority" type="int" value="25"/>
      <property name="Client3_PerScreen" type="bool" value="false"/>
    </property>
  </property>
</channel>
`;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
function alive(pid: number) { try { process.kill(pid, 0); return true; } catch { return false; } }
async function ticks(pid: number): Promise<string> { try { const s = await readFile(`/proc/${pid}/stat`, 'utf8'); return s.slice(s.lastIndexOf(')') + 2).split(' ')[19] ?? ''; } catch { return ''; } }
async function atomic(path: string, data: unknown) { const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`; await writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 }); await rename(tmp, path); }
function integer(n: unknown, min: number, max: number, name: string) { if (!Number.isInteger(n) || Number(n) < min || Number(n) > max) throw new BotdError(`${name} must be an integer in ${min}..${max}`); return Number(n); }

/** One same-UID private X11 session per desktop. No host services or global environment are modified. */
export class BotdSupervisor {
  readonly root: string;
  private options: BotdOptions;
  private initialized?: Promise<void>;
  private desktops = new Map<string, SavedDesktop>();
  private children = new Map<number, ChildProcess>();
  private queues = new Map<string, Promise<unknown>>();
  private displayQueue: Promise<unknown> = Promise.resolve();
  private persistQueue: Promise<void> = Promise.resolve();
  private locked = false;
  private closing = false;
  constructor(options: BotdOptions = {}) { this.options = options; this.root = resolve(options.root ?? DEFAULT_ROOT); }
  init() { return this.initialized ??= this.initialize().catch(error => { this.initialized = undefined; throw error; }); }
  private async initialize() {
    if (process.platform !== 'linux' || process.getuid?.() === undefined) throw new BotdError('dudu desktop requires Linux and same-UID process isolation');
    await mkdir(this.root, { recursive: true, mode: 0o700 }); await chmod(this.root, 0o700);
    const lock = join(this.root, 'supervisor.lock');
    for (let attempt = 0; attempt < 2; attempt++) {
      try { await mkdir(lock, { mode: 0o700 }); this.locked = true; break; }
      catch (e: any) {
        if (e.code !== 'EEXIST') throw e;
        const owner = await readFile(join(lock,'owner.json'), 'utf8').then(JSON.parse).catch(() => null);
        if (!owner) throw new BotdError(`Incomplete lock at ${lock}; inspect it before removing it`, 409);
        if (alive(owner.pid) && await ticks(owner.pid) === owner.startTicks) throw new BotdError('Another dudu process owns this root', 409);
        await rm(lock, { recursive: true });
      }
    }
    if (!this.locked) throw new BotdError('Could not acquire supervisor lock', 409);
    try {
      await atomic(join(lock,'owner.json'), { pid: process.pid, startTicks: await ticks(process.pid) });
      const saved: SavedDesktop[] = await readFile(join(this.root,'state.json'),'utf8').then(JSON.parse).catch((e: any) => { if (e.code === 'ENOENT') return []; throw e; });
      for (const d of saved) {
        validId(d.config.id); this.desktops.set(d.config.id, d);
        await this.cleanup(d); d.state = 'stopped'; d.recording = undefined;
      }
      await this.persist();
    } catch (error) { await rm(lock, { recursive: true, force: true }); this.locked = false; throw error; }
  }
  private persist() { this.persistQueue = this.persistQueue.catch(() => {}).then(() => atomic(join(this.root,'state.json'), [...this.desktops.values()])); return this.persistQueue; }
  private serial<T>(id: string, fn: () => Promise<T>): Promise<T> { validId(id); const p = (this.queues.get(id) ?? Promise.resolve()).catch(() => {}).then(fn); this.queues.set(id,p); void p.finally(() => { if (this.queues.get(id) === p) this.queues.delete(id); }).catch(() => {}); return p; }
  private dir(id: string) { validId(id); return join(this.root,'desktops',id); }
  private statusOf(d: SavedDesktop): DesktopStatus { return { ...d.config, state: d.state, display: d.display, port: d.port, error: d.error, watchUrl: d.state === 'ready' ? `http://127.0.0.1:${d.port}/` : undefined }; }
  async list(): Promise<DesktopStatus[]> { await this.init(); return [...this.desktops.values()].map(d => this.statusOf(d)); }
  async get(id: string): Promise<DesktopStatus> { await this.init(); return this.statusOf(this.lookup(id)); }
  async status(id?: string) { return id ? this.get(id) : this.list(); }
  private lookup(id: string) { validId(id); const d = this.desktops.get(id); if (!d) throw new BotdError(`Unknown desktop: ${id}`,404); return d; }
  private ready(id: string) { const d = this.lookup(id); if (d.state !== 'ready') throw new BotdError(`Desktop ${id} is not ready (${d.state})`,409); return d; }
  async doctor() { return { root: this.root, uid: process.getuid?.(), platform: process.platform, dependencies: Object.fromEntries(BINARIES.map(name => [name, Bun.which(name) ?? null])), isolation: 'same UID, private HOME/Xauthority/D-Bus; not a security sandbox' }; }
  private environment(d: SavedDesktop): Record<string,string> {
    const dir = this.dir(d.config.id), home = join(dir,'home'), runtime = process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid!()}`;
    return { PATH: '/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin', HOME: home, USER: process.env.USER ?? String(process.getuid!()), LOGNAME: process.env.USER ?? String(process.getuid!()), SHELL: '/bin/sh', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', DISPLAY: d.display!, XAUTHORITY: join(dir,'Xauthority'), XDG_RUNTIME_DIR: runtime, XDG_CONFIG_HOME: join(home,'.config'), XDG_CACHE_HOME: join(home,'.cache'), XDG_DATA_HOME: join(home,'.local/share'), XDG_STATE_HOME: join(home,'.local/state'), XDG_SESSION_TYPE: 'x11', XDG_CURRENT_DESKTOP: 'XFCE', DESKTOP_SESSION: 'xfce', DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(dir,'run/bus')}`,  GDK_BACKEND: 'x11', QT_QPA_PLATFORM: 'xcb', NO_AT_BRIDGE: '1', TMPDIR: join(dir,'tmp') };
  }
  private async launch(d: SavedDesktop, argv: string[], label: string, options: { env?: Record<string,string>; cwd?: string; input?: string; capture?: boolean } = {}) {
    const executable = Bun.which(argv[0]!); if (!executable) throw new BotdError(`Missing executable: ${argv[0]}. Install it separately; dudu never installs system packages.`,503);
    const child = spawn(executable,argv.slice(1),{ detached: true, env: { ...this.environment(d), ...options.env }, cwd: options.cwd ?? join(this.dir(d.config.id),'home'), stdio: ['pipe','pipe','pipe'] });
    const spawned = new Promise<void>((ok,no) => { child.once('spawn', ok); child.once('error', no); });
    const record: ProcessRecord = { pid: child.pid!, startTicks: '', label };
    let stdout = '', stderr = '', exceeded = false;
    const append = (stream: 'stdout' | 'stderr', data: Buffer) => { if (options.capture) { if (stdout.length + stderr.length + data.length > 4*1024*1024) { exceeded = true; void this.kill(record); } else if (stream === 'stdout') stdout += data.toString(); else stderr += data.toString(); } };
    child.stdout!.on('data', b => append('stdout',b)); child.stderr!.on('data', b => append('stderr',b));
    // Long-running children log only inside their private desktop directory.
    if (!options.capture) { const log = Bun.file(join(this.dir(d.config.id),`${label}.log`)).writer(); child.stdout!.on('data', b => log.write(b)); child.stderr!.on('data', b => log.write(b)); child.once('close',() => { void log.end(); }); }
    child.stdin!.end(options.input);
    const done = new Promise<ExecResult>(r => child.once('close',(code,signal) => {
      this.children.delete(record.pid); d.processes = d.processes.filter(p => p !== record); void this.persist();
      r({ code: exceeded ? 125 : code ?? (signal ? 128 : 1), stdout, stderr: exceeded ? stderr + '\nOutput exceeded 4 MiB' : stderr });
    }));
    child.once('exit', () => {
      // Reap descendants of our just-exited session leader, never a name-based host kill.
      try { process.kill(-child.pid!, 'SIGKILL'); } catch {}
      if (d.state === 'ready' && ['xvfb','dbus','xfce','voxl'].includes(label)) {
        d.state = 'error'; d.error = `${label} exited unexpectedly`; void this.serial(d.config.id,async () => { await this.cleanup(d); await this.persist(); });
      }
    });
    await spawned; record.pid = child.pid!; record.startTicks = await ticks(record.pid);
    if (child.exitCode === null && child.signalCode === null) { d.processes.push(record); this.children.set(record.pid,child); await this.persist(); }
    return { child, record, done };
  }
  private async command(d: SavedDesktop, argv: string[], timeoutMs = 15000, input?: string, env?: Record<string,string>, cwd?: string): Promise<ExecResult> {
    const task = await this.launch(d,argv,'command',{ capture: true, input, env, cwd });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; void this.kill(task.record); },timeoutMs);
    try { const result = await task.done; if (timedOut) throw new BotdError(`Command timed out after ${timeoutMs}ms`,504); return result; } finally { clearTimeout(timer); }
  }
  private async check(d: SavedDesktop, argv: string[], timeout = 10000, input?: string) { const r = await this.command(d,argv,timeout,input); if (r.code !== 0) throw new BotdError(`${argv[0]} failed (${r.code}): ${r.stderr.slice(-2000)}`,503); return r.stdout; }
  private async kill(p: ProcessRecord) {
    if (!p.startTicks || await ticks(p.pid) !== p.startTicks) return;
    try { process.kill(-p.pid,'SIGTERM'); } catch {}
    for (let i = 0; i < 20 && await ticks(p.pid) === p.startTicks; i++) await sleep(50);
    // The group number cannot be reused while a member still exists. Never signal unrelated process groups.
    try { process.kill(-p.pid,'SIGKILL'); } catch {}
  }
  private async cleanup(d: SavedDesktop) { await Promise.all([...d.processes].reverse().map(p => this.kill(p))); d.processes = []; d.recording = undefined; }
  private async wmPresent(d: SavedDesktop): Promise<boolean> {
    const output = await this.check(d,['xprop','-root','_NET_SUPPORTING_WM_CHECK']);
    const match = output.match(/0x[0-9a-f]+/i);
    if (!match || match[0] === '0x0') return false;
    return /xfwm/i.test(await this.check(d,['xprop','-id',match[0],'_NET_WM_NAME']));
  }
  /** A mapped window with this WM_CLASS exists on the desktop's display. */
  private async mapped(d: SavedDesktop, cls: string): Promise<boolean> {
    const r = await this.command(d,['xdotool','search','--onlyvisible','--class',cls],3000);
    return r.code === 0 && r.stdout.trim().length > 0;
  }
  private async waitFor(fn: () => Promise<boolean>, d: SavedDesktop, what: string) {
    const end = Date.now() + (this.options.startupTimeoutMs ?? 30000); let error: unknown;
    while (Date.now() < end) {
      if (this.closing) throw new BotdError('Supervisor is shutting down',503);
      if (d.processes.some(p => ['xvfb','dbus','xfce','voxl'].includes(p.label) && !alive(p.pid))) break;
      try { if (await fn()) return; } catch (e) { error = e; }
      await sleep(200);
    }
    throw new BotdError(`Desktop did not become ready: ${what}${error instanceof Error ? ` (${error.message})` : ''}`,503);
  }
  /** Remove an X lock left behind by a killed server, never a live one. */
  private async clearStaleDisplayLock(n: number): Promise<boolean> {
    const lock = `/tmp/.X${n}-lock`;
    try {
      const pid = Number((await readFile(lock, 'utf8')).trim());
      if (!Number.isInteger(pid) || pid <= 0 || alive(pid)) return false;
      await rm(lock, { force: true });
      await rm(`/tmp/.X11-unix/X${n}`, { force: true });
      return true;
    } catch { return false; }
  }
  /** Serialize display allocation: concurrent starts must never choose the same X display. */
  private allocateDisplay(d: SavedDesktop): Promise<void> {
    const task = this.displayQueue.then(async () => {
      for (let n = 90; n < 1000; n++) {
        if ([...this.desktops.values()].some(other => other !== d && other.display === `:${n}` && ['ready','starting'].includes(other.state))) continue;
        if (await lstat(`/tmp/.X${n}-lock`).then(() => true).catch(() => false)) {
          if (!await this.clearStaleDisplayLock(n)) continue;
        }
        if (await lstat(`/tmp/.X11-unix/X${n}`).then(() => true).catch(() => false)) continue;
        d.display = `:${n}`;
        return;
      }
      throw new BotdError('No free X display',503);
    });
    this.displayQueue = task.catch(() => {});
    return task;
  }
  async start(config: DesktopConfig): Promise<DesktopStatus> {
    await this.init(); validId(config.id); validId(config.botId); integer(config.width,320,7680,'width'); integer(config.height,240,4320,'height');
    return this.serial(config.id,async () => {
      if (this.closing) throw new BotdError('Supervisor is shutting down',503);
      const old = this.desktops.get(config.id); if (old?.state === 'ready') { if (JSON.stringify(old.config) !== JSON.stringify(config)) throw new BotdError('Stop desktop before changing configuration',409); return this.statusOf(old); }
      if (old) await this.cleanup(old);
      const d: SavedDesktop = { config: { ...config }, state: 'starting', processes: [] }; this.desktops.set(config.id,d); await this.persist();
      try {
        const missing = BINARIES.filter(n => !Bun.which(n)); if (missing.length) throw new BotdError(`Missing desktop dependencies: ${missing.join(', ')}. voxl is tembo/voxl (voxl-server); no packages were installed.`,503);
        const dir = this.dir(config.id);
        // Runtime sockets belong to one session. A stale bus socket must not make
        // a new D-Bus look alive or prevent the next daemon from binding.
        await rm(join(dir,'run'),{recursive:true,force:true});
        for (const sub of ['', 'home','home/.config','home/.cache','home/.local/share','home/.local/state','run','tmp','files','recordings']) await mkdir(join(dir,sub),{ recursive: true, mode: 0o700 });
        await chmod(join(dir,'run'),0o700);
        // X sockets are necessarily host-global. Never delete a socket or lock belonging to another X server.
        await this.allocateDisplay(d);
        if (!d.display) throw new BotdError('No free X display',503);
        const listener = Bun.listen({ hostname:'127.0.0.1',port:0,socket:{ data(){} } }); d.port = listener.port; listener.stop(true);
        d.password = randomBytes(32).toString('hex');
        await writeFile(join(dir,'Xauthority'),'',{ mode:0o600 }); await chmod(join(dir,'Xauthority'),0o600);
        await this.check(d,['xauth','-f',join(dir,'Xauthority'),'add',d.display,'MIT-MAGIC-COOKIE-1',randomBytes(16).toString('hex')]);
        await this.launch(d,['Xvfb',d.display,'-screen','0',`${config.width}x${config.height}x24`,'-auth',join(dir,'Xauthority'),'-nolisten','tcp','-noreset','-shmem'],'xvfb');
        await this.waitFor(async () => (await this.command(d,['xdpyinfo'],3000)).code === 0,d,'authenticated X11 connection');
        const busConfig = join(dir,'dbus.conf');
        // servicedir 让 DBus activation 能找到 xfwm4/xfsettingsd 等桌面服务；仍不接 systemd，不污染宿主。
        await writeFile(busConfig,`<busconfig><type>session</type><listen>unix:path=${join(dir,'run/bus').replaceAll('&','&amp;').replaceAll('<','&lt;')}</listen><auth>EXTERNAL</auth><servicedir>/usr/share/dbus-1/services</servicedir><policy context="default"><allow send_destination="*" eavesdrop="true"/><allow eavesdrop="true"/><allow own="*"/></policy></busconfig>`,{mode:0o600});
        await this.launch(d,['dbus-daemon',`--config-file=${busConfig}`,'--nofork','--nopidfile'],'dbus');
        await this.waitFor(async () => lstat(join(dir,'run/bus')).then(s => s.isSocket()).catch(() => false),d,'private D-Bus');
        // Seed the channel once: xfce4-session only writes it when a session is
        // saved, and the agent startup it disables is never wanted here.
        const channel = join(dir,'home/.config/xfce4/xfconf/xfce-perchannel-xml/xfce4-session.xml');
        if (!await Bun.file(channel).exists()) { await mkdir(dirname(channel),{recursive:true,mode:0o700}); await writeFile(channel,SESSION_XML,{mode:0o600}); }
        await this.launch(d,['xfce4-session','--disable-tcp'],'xfce');
        // A desktop is only usable once the window manager, the panel and the
        // desktop window are up; a WM alone leaves a black screen.
        await this.waitFor(() => this.wmPresent(d),d,'Xfce window manager');
        await this.waitFor(() => this.mapped(d,'xfce4-panel'),d,'Xfce panel');
        await this.waitFor(() => this.mapped(d,'xfdesktop'),d,'Xfce desktop');
        // voxl reads DISPLAY for the X session and VOXL_PASSWORD for basic auth.
        await this.launch(d,['voxl','--addr=127.0.0.1',`--port=${d.port}`,'--enable-basic-auth=true'],'voxl',{env:{VOXL_PASSWORD:d.password}});
        await this.waitFor(async () => { const r = await fetch(`http://127.0.0.1:${d.port}/healthz`,{signal:AbortSignal.timeout(2000)}); return r.ok; },d,'voxl health');
        await this.waitFor(async () => { await this.capture(d); return true; },d,'authenticated PNG screenshot');
        d.state = 'ready'; await this.persist(); return this.statusOf(d);
      } catch (e) { d.state = 'error'; d.error = e instanceof Error ? e.message : String(e); await this.cleanup(d); await this.persist(); throw e; }
    });
  }
  async stop(id: string): Promise<DesktopStatus> { await this.init(); return this.serial(id,async () => { const d = this.lookup(id); d.state = 'stopped'; await this.cleanup(d); await this.persist(); return this.statusOf(d); }); }
  async restart(id: string) { await this.init(); const config = { ...this.lookup(id).config }; await this.stop(id); return this.start(config); }
  private async capture(d: SavedDesktop): Promise<Uint8Array> {
    const r = await fetch(`http://127.0.0.1:${d.port}/screenshot`, {headers:{Authorization:`Bearer ${d.password}`},signal:AbortSignal.timeout(10000)});
    if (!r.ok) throw new BotdError(`voxl screenshot returned HTTP ${r.status}`,502);
    const data = new Uint8Array(await r.arrayBuffer()); if (data.length < 24 || !Buffer.from(data.subarray(0,8)).equals(PNG)) throw new BotdError('voxl did not return a PNG screenshot',502); return data;
  }
  async shot(id: string) { await this.init(); return this.capture(this.ready(id)); }
  async click(id: string, options: {x:number;y:number;button?:number;count?:number}) { await this.init(); const d = this.ready(id); const x = integer(options.x,0,d.config.width-1,'x'), y = integer(options.y,0,d.config.height-1,'y'); await this.check(d,['xdotool','mousemove','--sync',String(x),String(y),'click','--clearmodifiers','--repeat',String(integer(options.count ?? 1,1,10,'count')),String(integer(options.button ?? 1,1,9,'button'))]); }
  async key(id: string, key: string) { await this.init(); if (typeof key !== 'string' || !/^[A-Za-z0-9_+:-]{1,200}$/.test(key) || key.startsWith('-')) throw new BotdError('Invalid X11 key sequence'); await this.check(this.ready(id),['xdotool','key','--clearmodifiers',key]); }
  async scroll(id: string, options: {direction:'up'|'down'|'left'|'right';amount?:number}) { await this.init(); const button = {up:4,down:5,left:6,right:7}[options.direction]; if (!button) throw new BotdError('Invalid scroll direction'); await this.check(this.ready(id),['xdotool','click','--clearmodifiers','--repeat',String(integer(options.amount ?? 3,1,100,'amount')),String(button)]); }
  async type(id: string, text: string) { await this.init(); if (typeof text !== 'string' || Buffer.byteLength(text) > 1024*1024) throw new BotdError('Text must be a string of at most 1 MiB'); const d = this.ready(id); for (const p of d.processes.filter(p => p.label === 'clipboard')) await this.kill(p); const task = await this.launch(d,['xclip','-quiet','-selection','clipboard','-in'],'clipboard',{input:text}); await sleep(80); if (task.child.exitCode !== null) throw new BotdError('xclip failed to own the clipboard',503); await this.key(id,'ctrl+v'); }
  async exec(id: string, options: ExecOptions) { await this.init(); if (!Array.isArray(options.argv) || options.argv.length === 0 || options.argv.some(a => typeof a !== 'string' || a.includes('\0'))) throw new BotdError('argv must be a nonempty string array'); if (options.env && Object.entries(options.env).some(([k,v]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) || typeof v !== 'string' || ['DISPLAY','XAUTHORITY','DBUS_SESSION_BUS_ADDRESS','XDG_RUNTIME_DIR','HOME'].includes(k))) throw new BotdError('Invalid or reserved environment variable'); const d = this.ready(id); return this.command(d,options.argv,integer(options.timeoutMs ?? 30000,1,300000,'timeoutMs'),undefined,options.env,options.cwd ?? join(this.dir(id),'home')); }
  private async filePath(id: string, path: string, create = false) {
    this.lookup(id); if (typeof path !== 'string' || !path || isAbsolute(path) || path.includes('\0')) throw new BotdError('File path must be relative to the desktop files directory');
    const base = join(this.dir(id),'files'), target = resolve(base,path); if (!target.startsWith(base+sep)) throw new BotdError('File path escapes desktop files directory');
    // Walk every component to reject symlinks, including dangling symlinks. exec is trusted same-UID, not a sandbox.
    const parts = target.slice(base.length+1).split(sep); let cursor = base;
    for (let i=0;i<parts.length;i++) { cursor = join(cursor,parts[i]!); const info = await lstat(cursor).catch((e: any) => { if (e.code==='ENOENT') return null; throw e; }); if (info?.isSymbolicLink()) throw new BotdError('Symlinks are not allowed in file transfers'); if (!info && create && i < parts.length-1) await mkdir(cursor,{mode:0o700}); }
    if ((await realpath(base)) !== base) throw new BotdError('Desktop files directory is not canonical'); return target;
  }
  async upload(id: string, path: string, data: Uint8Array) { await this.init(); this.ready(id); if (data.length > 64*1024*1024) throw new BotdError('Upload exceeds 64 MiB',413); const target = await this.filePath(id,path,true); await writeFile(target,data,{mode:0o600}); return {path,bytes:data.length}; }
  async download(id: string, path: string): Promise<Uint8Array> { await this.init(); const target = await this.filePath(id,path); const info = await lstat(target).catch(() => { throw new BotdError('File not found',404); }); if (!info.isFile()) throw new BotdError('Not a regular file'); if (info.size>64*1024*1024) throw new BotdError('Download exceeds 64 MiB',413); return readFile(target); }
  async recordStart(id: string, options: {fps?:number} = {}): Promise<RecordingInfo> { await this.init(); return this.serial(id,async () => { const d = this.ready(id); if (d.recording) throw new BotdError('Recording already running',409); const recordId = randomBytes(8).toString('hex'), path = `recordings/${recordId}.mkv`; const task = await this.launch(d,['ffmpeg','-nostdin','-hide_banner','-loglevel','warning','-f','x11grab','-draw_mouse','1','-framerate',String(integer(options.fps ?? 15,1,60,'fps')),'-video_size',`${d.config.width}x${d.config.height}`,'-i',`${d.display}.0`,'-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-y',join(this.dir(id),path)],'record'); await sleep(300); if (task.child.exitCode !== null || task.child.signalCode !== null) throw new BotdError('ffmpeg recording failed; inspect private record.log',503); d.recording = {id:recordId,path,startedAt:new Date().toISOString()}; await this.persist(); return d.recording; }); }
  async recordStop(id: string): Promise<RecordingInfo> { await this.init(); return this.serial(id,async () => { const d = this.lookup(id); if (!d.recording) throw new BotdError('No recording in progress',409); const info = d.recording; const p = d.processes.find(p => p.label==='record'); if (p && await ticks(p.pid) === p.startTicks) { try { process.kill(-p.pid,'SIGINT'); } catch {} for (let i=0;i<100 && alive(p.pid);i++) await sleep(50); if (alive(p.pid)) await this.kill(p); } d.recording=undefined; await this.persist(); return info; }); }
  async recording(id: string, recordId: string): Promise<Uint8Array> { await this.init(); validId(id); if (!/^[a-f0-9]{16}$/.test(recordId)) throw new BotdError('Invalid recording identifier'); this.lookup(id); const path=join(this.dir(id),'recordings',`${recordId}.mkv`); const s=await lstat(path).catch(() => { throw new BotdError('Recording not found',404); }); if (!s.isFile() || s.isSymbolicLink()) throw new BotdError('Invalid recording'); if(s.size>256*1024*1024) throw new BotdError('Recording exceeds 256 MiB download limit',413); return readFile(path); }
  async watch(id: string): Promise<WatchInfo> { await this.init(); const d = this.lookup(id); return {id,state:d.state,display:d.display,port:d.port,url:d.state==='ready'?`http://127.0.0.1:${d.port}/?token=${encodeURIComponent(d.password!)}`:undefined,username:'dudu',password:d.password,localOnly:true}; }

  // ── cua-aligned computer-use surface ─────────────────────────────────────
  // Method names/signatures mirror cua's Computer interface (spacesd + Python SDK).
  // Deliberately not implemented: mobile/Android gestures, app-store install,
  // CDP browser tools (no X11 equivalent), audio media, pointer/keyboard proto escape hatches.

  async screen_size(id: string) { const d = this.ready(id); return {width: d.config.width, height: d.config.height}; }
  async displays(id: string) { const d = this.ready(id); return [{id: 0, name: d.display!, width: d.config.width, height: d.config.height, primary: true}]; }
  async move(id: string, x: number, y: number) { const d = this.ready(id); await this.check(d,['xdotool','mousemove','--sync',String(integer(x,0,d.config.width-1,'x')),String(integer(y,0,d.config.height-1,'y'))]); }
  async double_click(id: string, x: number, y: number) { await this.move(id,x,y); await this.check(this.ready(id),['xdotool','click','--clearmodifiers','--repeat','2','1']); }
  async right_click(id: string, x: number, y: number) { await this.move(id,x,y); await this.check(this.ready(id),['xdotool','click','--clearmodifiers','3']); }
  async drag(id: string, start_x: number, start_y: number, end_x: number, end_y: number, button: 'left'|'right'|'middle' = 'left') {
    const d = this.ready(id); const btn = {left:1,middle:2,right:3}[button]; if (!btn) throw new BotdError('Invalid drag button');
    await this.check(d,['xdotool','mousemove','--sync',String(integer(start_x,0,d.config.width-1,'start_x')),String(integer(start_y,0,d.config.height-1,'start_y')),'mousedown',String(btn),'mousemove','--sync',String(integer(end_x,0,d.config.width-1,'end_x')),String(integer(end_y,0,d.config.height-1,'end_y')),'mouseup',String(btn)]);
  }
  async mouse_down(id: string, button: 'left'|'right'|'middle' = 'left') { const btn = {left:1,middle:2,right:3}[button]; if (!btn) throw new BotdError('Invalid mouse button'); await this.check(this.ready(id),['xdotool','mousedown',String(btn)]); }
  async mouse_up(id: string, button: 'left'|'right'|'middle' = 'left') { const btn = {left:1,middle:2,right:3}[button]; if (!btn) throw new BotdError('Invalid mouse button'); await this.check(this.ready(id),['xdotool','mouseup',String(btn)]); }
  /** cua semantics: scroll scroll_x/scroll_y "rows" at (x, y); positive y scrolls down. */
  async scrollAt(id: string, x: number, y: number, scroll_x = 0, scroll_y = 3) {
    const d = this.ready(id); await this.move(id,x,y);
    const count = integer(Math.abs(scroll_y),0,100,'scroll_y'); if (count) await this.check(d,['xdotool','click','--clearmodifiers','--repeat',String(count),scroll_y > 0 ? '5' : '4']);
    const countX = integer(Math.abs(scroll_x),0,100,'scroll_x'); if (countX) await this.check(d,['xdotool','click','--clearmodifiers','--repeat',String(countX),scroll_x > 0 ? '7' : '6']);
  }
  async keypress(id: string, keys: string[] | string) { const combo = (Array.isArray(keys) ? keys : String(keys).split('+')).filter(Boolean).map(k => k.trim().toLowerCase()).join('+'); if (!combo || combo.length > 200 || /[^a-zA-Z0-9_+:-]/.test(combo)) throw new BotdError('Invalid key combination'); await this.check(this.ready(id),['xdotool','key','--clearmodifiers',combo]); }
  async key_down(id: string, key: string) { if (typeof key !== 'string' || !/^[A-Za-z0-9_]{1,40}$/.test(key)) throw new BotdError('Invalid key name'); await this.check(this.ready(id),['xdotool','keydown',key]); }
  async key_up(id: string, key: string) { if (typeof key !== 'string' || !/^[A-Za-z0-9_]{1,40}$/.test(key)) throw new BotdError('Invalid key name'); await this.check(this.ready(id),['xdotool','keyup',key]); }
  async cursor_position(id: string): Promise<{x:number;y:number}> {
    const out = await this.check(this.ready(id),['xdotool','getmouselocation']);
    const x = /x:(\d+)/.exec(out)?.[1], y = /y:(\d+)/.exec(out)?.[1]; if (x === undefined || y === undefined) throw new BotdError('Could not parse pointer location'); return {x: Number(x), y: Number(y)};
  }
  async clipboard_get(id: string): Promise<string> { const r = await this.command(this.ready(id),['xclip','-o','-selection','clipboard'],5000); return r.stdout; }
  async clipboard_set(id: string, text: string) {
    if (typeof text !== 'string' || Buffer.byteLength(text) > 1024*1024) throw new BotdError('Clipboard text must be at most 1 MiB');
    const d = this.ready(id);
    // 与 type() 相同的持有方式：xclip -quiet 常驻进程持有 selection，替换旧持有者。
    for (const p of d.processes.filter(p => p.label === 'clipboard')) await this.kill(p);
    const task = await this.launch(d,['xclip','-quiet','-selection','clipboard','-in'],'clipboard',{input:text});
    await sleep(80);
    if (task.child.exitCode !== null) throw new BotdError('xclip failed to own the clipboard',503);
  }
  /** cua-style screenshot with format/quality/region/max_dimension/include_cursor. */
  async screenshot(id: string, options: {format?:'png'|'jpeg'|'webp';quality?:number;x?:number;y?:number;width?:number;height?:number;max_dimension?:number;include_cursor?:boolean} = {}): Promise<Uint8Array> {
    const d = this.ready(id); const format = options.format ?? 'png';
    const w = options.width ?? d.config.width, h = options.height ?? d.config.height;
    const x = options.x ?? 0, y = options.y ?? 0;
    integer(x,0,d.config.width-1,'x'); integer(y,0,d.config.height-1,'y'); integer(w,1,d.config.width,'width'); integer(h,1,d.config.height,'height');
    const filters: string[] = []; if (options.max_dimension !== undefined) { const m = integer(options.max_dimension,16,7680,'max_dimension'); filters.push(`scale=w=min(iw\\,${m}):h=min(ih\\,${m}):force_original_aspect_ratio=decrease`); }
    const out = join(this.dir(id),'tmp',`shot-${randomBytes(4).toString('hex')}.${format}`);
    const args = ['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-f','x11grab','-draw_mouse',options.include_cursor === false ? '0' : '1','-video_size',`${w}x${h}`,'-i',`${d.display}+${x},${y}`];
    if (format === 'jpeg') args.push('-q:v',String(integer(options.quality ?? 80,2,31,'quality'))); if (format === 'webp') args.push('-quality',String(integer(options.quality ?? 80,1,100,'quality')));
    if (filters.length) args.push('-vf',filters.join(','));
    args.push('-frames:v','1','-y',out);
    const r = await this.command(d,args,15000); if (r.code !== 0) throw new BotdError(`screenshot failed: ${r.stderr.slice(-500)}`,503);
    try { return await readFile(out); } finally { await rm(out,{force:true}); }
  }
  async window_list(id: string) { const d = this.ready(id); const ids = (await this.check(d,['xdotool','search','--onlyvisible','.'])).split('\n').map(s => s.trim()).filter(Boolean); const list: {id:number;title:string;active:boolean}[] = []; const active = (await this.command(d,['xdotool','getactivewindow'],3000)).stdout.trim(); for (const wid of ids.slice(0,64)) { const title = (await this.command(d,['xdotool','getwindowname',wid],3000)).stdout.trim(); list.push({id: Number(wid), title, active: wid === active}); } return list; }
  async window_active_title(id: string) { return (await this.check(this.ready(id),['sh','-c','xdotool getactivewindow getwindowname'])).trim(); }
  async window_activate(id: string, windowId: number) { await this.check(this.ready(id),['xdotool','windowactivate','--sync',String(integer(windowId,1,Number.MAX_SAFE_INTEGER,'windowId'))]); }

  // Files use the whole same-UID filesystem. NUL and relative paths are rejected; this is not a sandbox.
  private async fsPath(id: string, path: string): Promise<string> {
    this.lookup(id); if (typeof path !== 'string' || !path || path.includes('\0') || !isAbsolute(path)) throw new BotdError('Path must be absolute (same-UID filesystem, not a sandbox)');
    return resolve(path);
  }
  async files_read_text(id: string, path: string) { const target = await this.fsPath(id,path); return readFile(target,'utf8'); }
  async files_write_text(id: string, path: string, content: string) { if (typeof content !== 'string' || Buffer.byteLength(content) > 8*1024*1024) throw new BotdError('Content exceeds 8 MiB'); const target = await this.fsPath(id,path); await mkdir(dirname(target),{recursive:true}); await writeFile(target,content,{mode:0o600}); }
  async files_read_bytes(id: string, path: string, offset = 0, length?: number) { const target = await this.fsPath(id,path); const info = await lstat(target).catch(() => { throw new BotdError('File not found',404); }); if (!info.isFile()) throw new BotdError('Not a regular file'); const fh = Bun.file(target); const total = info.size; const start = integer(offset,0,Math.max(total-1,0),'offset'); const len = Math.min(integer(length ?? total-start,1,32*1024*1024,'length'), total-start); return new Uint8Array(await fh.slice(start,start+len).arrayBuffer()); }
  async files_write_bytes(id: string, path: string, data: Uint8Array) { if (data.length > 64*1024*1024) throw new BotdError('Content exceeds 64 MiB',413); const target = await this.fsPath(id,path); await mkdir(dirname(target),{recursive:true}); await writeFile(target,data,{mode:0o600}); }
  async files_list(id: string, path: string) { const target = await this.fsPath(id,path); const entries = await readdir(target,{withFileTypes:true}).catch(e => { throw new BotdError(e.code === 'ENOENT' ? 'Path not found' : `Cannot list: ${e.code ?? e.message}`,404); }); return entries.map(e => ({name: e.name, type: e.isDirectory() ? 'dir' : e.isSymbolicLink() ? 'symlink' : 'file'})); }
  async files_make_dir(id: string, path: string) { const target = await this.fsPath(id,path); await mkdir(target,{recursive:true,mode:0o700}); }
  private async fsRemove(id: string, path: string, recursive: boolean) { const target = await this.fsPath(id,path); const info = await lstat(target).catch(() => { throw new BotdError('Path not found',404); }); if (info.isDirectory() && !recursive) throw new BotdError('Directory requires remove_dir'); await rm(target,{recursive,force:false}); }
  async files_remove(id: string, path: string) { await this.fsRemove(id,path,false); }
  async files_remove_dir(id: string, path: string) { await this.fsRemove(id,path,true); }
  async files_exists(id: string, path: string) { return {exists: !!(await lstat(await this.fsPath(id,path)).catch(() => null))}; }
  async files_is_dir(id: string, path: string) { const info = await lstat(await this.fsPath(id,path)).catch(() => null); return {is_dir: !!info?.isDirectory()}; }
  async files_size(id: string, path: string) { const info = await lstat(await this.fsPath(id,path)).catch(() => { throw new BotdError('File not found',404); }); return {size: info.size}; }

  // Shell: cua `run(command, timeout, background)` semantics on the desktop session env.
  // Background processes tee combined output to a per-desktop log file readable via process_read.
  private background = new Map<number, {pid:number;command:string;startedAt:string;log:string;startTicks:string}>();
  async run(id: string, options: {command:string;timeout?:number;background?:boolean}) {
    if (typeof options.command !== 'string' || !options.command.trim() || options.command.includes('\0')) throw new BotdError('command must be a nonempty shell string');
    const d = this.ready(id); const timeoutMs = integer(options.timeout ?? 30,1,3600,'timeout') * 1000;
    if (!options.background) {
      const r = await this.command(d,['sh','-c',options.command],timeoutMs);
      return {stdout: r.stdout.slice(0,1024*1024), stderr: r.stderr.slice(0,256*1024), returncode: r.code, success: r.code === 0};
    }
    const log = join(this.dir(id),'tmp',`run-${randomBytes(4).toString('hex')}.log`);
    const child = spawn(Bun.which('bash') ?? '/bin/bash',['-c','exec > >(cat >> "$1") 2>&1; exec bash -c "$2"','bash',log,options.command],{detached:true,env:this.environment(d),cwd:join(this.dir(id),'home'),stdio:['ignore','ignore','ignore']});
    await new Promise<void>((ok,no) => { child.once('spawn',ok); child.once('error',no); });
    const startTicks = await ticks(child.pid!);
    this.background.set(child.pid!,{pid:child.pid!,command:options.command,startedAt:new Date().toISOString(),log,startTicks});
    child.once('close',() => this.background.delete(child.pid!));
    return {pid: child.pid!, returncode: null as number|null, stdout: '', stderr: '', success: true, log};
  }
  async process_list(id: string) { this.ready(id); return [...this.background.values()].map(p => ({pid: p.pid, command: p.command, startedAt: p.startedAt, alive: alive(p.pid)})); }
  async process_kill(id: string, pid: number) { const p = this.background.get(integer(pid,1,Number.MAX_SAFE_INTEGER,'pid')); if (!p) throw new BotdError('Unknown background process',404); try { process.kill(-p.pid,'SIGTERM'); } catch {} this.background.delete(p.pid); return {killed: true}; }
  async process_read(id: string, pid: number) { const p = this.background.get(integer(pid,1,Number.MAX_SAFE_INTEGER,'pid')); if (!p) throw new BotdError('Unknown background process',404); const data = await readFile(p.log,'utf8').catch(() => ''); return {pid: p.pid, output: data.slice(-256*1024), alive: alive(p.pid)}; }

  // Terminal: interactive PTY sessions via util-linux `script`.
  private terminals = new Map<number, {child: import('node:child_process').ChildProcess; buffer: string; startTicks: string; command: string}>();
  async terminal_create(id: string, options: {command?:string;cols?:number;rows?:number} = {}) {
    const d = this.ready(id); const cols = integer(options.cols ?? 80,20,500,'cols'), rows = integer(options.rows ?? 24,5,200,'rows');
    const command = options.command?.trim() || '/bin/sh';
    const child = spawn(Bun.which('script')!,['-qfc',command,'/dev/null'],{detached:true,env:{...this.environment(d),TERM:'xterm-256color',COLUMNS:String(cols),LINES:String(rows)},cwd:join(this.dir(id),'home'),stdio:['pipe','pipe','pipe']});
    await new Promise<void>((ok,no) => { child.once('spawn',ok); child.once('error',no); });
    const startTicks = await ticks(child.pid!);
    this.terminals.set(child.pid!, {child, buffer:'', startTicks, command});
    child.stdout!.on('data',(b:Buffer)=>{const t=this.terminals.get(child.pid!); if(t) t.buffer=(t.buffer+b.toString()).slice(-256*1024);});
    child.stderr!.on('data',(b:Buffer)=>{const t=this.terminals.get(child.pid!); if(t) t.buffer=(t.buffer+b.toString()).slice(-256*1024);});
    child.once('close',()=>this.terminals.delete(child.pid!));
    return {pid: child.pid!, command};
  }
  async terminal_send(id: string, pid: number, data: string) { const t = this.termTerm(pid); t.child.stdin!.write(data); }
  async terminal_read(id: string, pid: number) { const t = this.termTerm(pid); const out = t.buffer; t.buffer = ''; return out; }
  async terminal_info(id: string, pid: number) { const t = this.termTerm(pid); return {pid, command: t.command, alive: alive(pid) && await ticks(pid) === t.startTicks}; }
  async terminal_close(id: string, pid: number) { const t = this.termTerm(pid); try { process.kill(-pid,'SIGKILL'); } catch {} this.terminals.delete(pid); }
  private termTerm(pid: number) { const t = this.terminals.get(integer(pid,1,Number.MAX_SAFE_INTEGER,'pid')); if (!t) throw new BotdError('Unknown terminal session',404); return t; }

  async close() { if (!this.initialized) return; await this.init(); this.closing=true; await Promise.allSettled([...this.queues.values()]); for (const d of this.desktops.values()) { d.state='stopped'; await this.cleanup(d); } await this.persist(); if (this.locked) { await rm(join(this.root,'supervisor.lock'),{recursive:true,force:true}); this.locked=false; } }
}
export { BINARIES };
