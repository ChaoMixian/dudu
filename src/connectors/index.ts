import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { McpServerConfig } from '@earendil-works/pi-coding-agent';
import { id, object, text, type ConnectorDefinition } from '../contracts';
import { catalogEntry, type BuiltinCatalogEntry, type BuiltinProvider, type BuiltinProviderContext } from './types';

export interface CallOptions { signal?: AbortSignal; timeoutMs?: number; maxOutputBytes?: number }
export type Connector = ConnectorDefinition & { headers?: Record<string, string>; timeoutMs?: number };
export type PublicConnector = Omit<Connector, 'credentials'> & { credentialsSet?: string[]; runtime?: Record<string, unknown> };

export function stringMap(value: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, val] of Object.entries(object(value))) { if (typeof val !== 'string') throw new Error(`${key} must be a string`); result[key] = val; }
  return result;
}
export function argv(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.some(v => typeof v !== 'string' || v.includes('\0')) || !value[0].trim()) throw new Error('Expected nonempty fixed argv');
  return [...value];
}
/** Explicitly do not inherit credentials or shell startup configuration. */
export function minimalEnv(extra: Record<string, string> = {}): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'LANG', 'TZ']) if (process.env[key]) result[key] = process.env[key]!;
  return { ...result, ...extra };
}
export function validateConnector(value: unknown, providers: ReadonlyMap<string, BuiltinProvider> = new Map()): Connector {
  const v = object(value); id(v.id); text(v.name, 'name');
  if (v.id === 'computer') throw new Error('Connector ID "computer" is reserved for the built-in computer capability');
  if (typeof v.description !== 'string') throw new Error('description must be a string');
  if (!['command', 'http', 'mcp', 'builtin'].includes(v.transport)) throw new Error('Invalid connector transport');
  if (v.transport === 'builtin') {
    if (typeof v.provider !== 'string' || !v.provider.trim()) throw new Error('Builtin connector requires provider');
    const provider = providers.get(v.provider);
    if (!provider) throw new Error(`Unknown builtin provider: ${v.provider}`);
    const normalized = provider.normalize(object(v.settings ?? {}), v.credentials === undefined ? {} : stringMap(v.credentials));
    return structuredClone({ ...v, settings: normalized.settings, credentials: normalized.credentials, tools: provider.tools }) as Connector;
  }
  if (v.provider !== undefined || v.settings !== undefined || v.credentials !== undefined) throw new Error('provider/settings/credentials require builtin transport');
  if (v.transport === 'command' || (v.transport === 'mcp' && !v.url)) argv(v.argv);
  if (v.transport === 'http' || v.url !== undefined) { const url = new URL(v.url); if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Expected HTTP URL'); }
  if (v.env !== undefined) stringMap(v.env);
  if (v.headers !== undefined) stringMap(v.headers);
  if (v.timeoutMs !== undefined && (!Number.isFinite(v.timeoutMs) || v.timeoutMs <= 0)) throw new Error('Invalid timeoutMs');
  if (!Array.isArray(v.tools)) throw new Error('tools must be an array');
  const names = new Set<string>();
  for (const tool of v.tools) { text(tool.name); if (!/^[a-zA-Z0-9_-]+$/.test(tool.name) || names.has(tool.name)) throw new Error('Invalid or duplicate tool name'); names.add(tool.name); text(tool.description); object(tool.parameters); }
  return structuredClone(v) as Connector;
}
export class ConnectorRegistry {
  private providers = new Map<string, BuiltinProvider>();
  constructor(readonly root: string, builtins: BuiltinProvider[] = []) {
    for (const provider of builtins) this.providers.set(provider.id, provider);
  }
  provider(providerId: string): BuiltinProvider | undefined { return this.providers.get(providerId); }
  catalog(): BuiltinCatalogEntry[] { return [...this.providers.values()].map(catalogEntry).sort((a, b) => a.name.localeCompare(b.name)); }
  private path(connectorId: string) { return join(this.root, 'connectors', id(connectorId), 'connector.json'); }
  register(value: ConnectorDefinition): Connector {
    const connector = validateConnector(value, this.providers);
    const path = this.path(connector.id);
    mkdirSync(join(this.root, 'connectors', connector.id), { recursive: true });
    const tmp = `${path}.${crypto.randomUUID()}.tmp`; writeFileSync(tmp, JSON.stringify(connector, null, 2) + '\n', { mode: 0o600 }); renameSync(tmp, path); return connector;
  }
  /** Create a new connector with an opaque, server-generated ID. The ID is never user input. */
  create(value: ConnectorDefinition): Connector {
    const validated = validateConnector({ ...value, id: 'connector' }, this.providers);
    mkdirSync(join(this.root, 'connectors'), { recursive: true });
    const base = (validated.provider || validated.name).normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'connector';
    for (let attempt = 0; attempt < 20; attempt++) {
      const candidate = `${base}-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
      const dir = join(this.root, 'connectors', candidate);
      try { mkdirSync(dir); } catch (error: any) { if (error?.code === 'EEXIST') continue; throw error; }
      try { return this.register({ ...validated, id: candidate }); }
      catch (error) { rmSync(dir, { recursive: true, force: true }); throw error; }
    }
    throw new Error('Could not allocate a connector ID');
  }
  get(connectorId: string): Connector {
    const connector = validateConnector(JSON.parse(readFileSync(this.path(connectorId), 'utf8')), this.providers);
    if (connector.id !== connectorId) throw new Error('Connector file ID mismatch'); return connector;
  }
  list(): Connector[] {
    let entries; try { entries = readdirSync(join(this.root, 'connectors'), { withFileTypes: true }); } catch (error: any) { if (error.code === 'ENOENT') return []; throw error; }
    return entries.filter(e => e.isDirectory() && existsSync(join(this.root, 'connectors', e.name, 'connector.json'))).map(e => this.get(e.name)).sort((a,b) => a.id.localeCompare(b.id));
  }
  listPublic(): PublicConnector[] {
    return this.list().map(connector => {
      if (connector.transport !== 'builtin') return connector as PublicConnector;
      const { credentials = {}, ...rest } = connector;
      return { ...rest, credentialsSet: Object.keys(credentials).filter(key => Boolean(credentials[key])).sort() } as PublicConnector;
    });
  }
  setCredentials(connectorId: string, update: Record<string, string>): Connector {
    const connector = this.get(connectorId);
    const credentials: Record<string, string> = { ...(connector.credentials ?? {}) };
    for (const [key, value] of Object.entries(update)) { if (value) credentials[key] = value; else delete credentials[key]; }
    return this.register({ ...connector, credentials });
  }
  remove(connectorId: string) {
    const connector = this.get(connectorId);
    rmSync(join(this.root, 'connectors', connector.id), { recursive: true, force: true });
  }
  async disconnect(connectorId: string): Promise<void> {
    const connector = this.get(connectorId);
    if (connector.transport !== 'builtin') throw new Error('Only builtin connectors support disconnecting');
    const provider = this.providers.get(connector.provider!);
    if (!provider?.disconnect) throw new Error('This connector has no sign-in to disconnect');
    await provider.disconnect(this.context(connector));
  }
  async test(connectorId: string, options: CallOptions = {}): Promise<unknown> {
    const connector = this.get(connectorId);
    if (connector.transport !== 'builtin') throw new Error('Only builtin connectors support the test button');
    const provider = this.providers.get(connector.provider!);
    if (!provider?.test) throw new Error('This connector has no test action');
    return provider.test(this.context(connector), options);
  }
  /** Test an unsaved draft, merging stored secrets for an existing connector. */
  async testDraft(value: unknown, options: CallOptions = {}): Promise<unknown> {
    const v = object(value);
    let previous: Connector | undefined;
    if (typeof v.id === 'string' && v.id.trim()) { try { previous = this.get(v.id.trim()); } catch { /* new draft */ } }
    const incoming = v.credentials === undefined ? {} : stringMap(v.credentials);
    const credentials: Record<string, string> = { ...(previous?.credentials ?? {}) };
    for (const [key, val] of Object.entries(incoming)) if (val) credentials[key] = val;
    const connector = validateConnector({
      id: 'connector',
      name: 'Connector test',
      description: '',
      transport: 'builtin',
      provider: v.provider,
      settings: object(v.settings ?? {}),
      credentials,
      tools: [],
    }, this.providers);
    const provider = this.providers.get(connector.provider!);
    if (!provider?.test) throw new Error('This connector has no test action');
    return provider.test({ connectorId: previous?.id ?? 'test', settings: connector.settings ?? {}, credentials: connector.credentials ?? {} }, options);
  }
  private context(connector: Connector): BuiltinProviderContext {
    return {
      connectorId: connector.id,
      settings: connector.settings ?? {},
      credentials: connector.credentials ?? {},
      updateCredentials: credentials => { this.setCredentials(connector.id, credentials); },
    };
  }
  async call(connectorId: string, tool: string, args: unknown, options: CallOptions = {}): Promise<unknown> {
    const connector = this.get(connectorId);
    if (!connector.tools.some(t => t.name === tool)) throw new Error(`Unknown tool: ${tool}`);
    if (connector.transport === 'builtin') {
      const provider = this.providers.get(connector.provider!);
      if (!provider) throw new Error(`Unknown builtin provider: ${connector.provider}`);
      return provider.call(tool, object(args ?? {}), this.context(connector), options);
    }
    if (connector.transport === 'mcp') throw new Error('MCP calls belong to the official coding-agent MCP client');
    const body = { tool, arguments: args, config: {} };
    const timeoutMs = options.timeoutMs ?? connector.timeoutMs ?? 60_000;
    const max = options.maxOutputBytes ?? 4 * 1024 * 1024;
    const signal = AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(timeoutMs)]);
    signal.throwIfAborted();
    if (connector.transport === 'command') return runCommand(connector.argv!, body, { ...options, timeoutMs, maxOutputBytes: max }, connector.env ?? {});
    const response = await fetch(connector.url!, { method: 'POST', headers: { ...connector.headers, 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
    const reader = response.body?.getReader(); let size = 0; const chunks: Uint8Array[] = [];
    if (reader) try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > max) throw new Error('HTTP output limit exceeded'); chunks.push(part.value); } } finally { await reader.cancel(); }
    const output = Buffer.concat(chunks).toString();
    if (!response.ok) throw new Error(`HTTP connector returned ${response.status}: ${output.slice(0, 2048)}`);
    return JSON.parse(output);
  }
}
export function runCommand(command: string[], input: unknown, options: CallOptions = {}, env: Record<string,string> = {}): Promise<unknown> {
  argv(command); const encoded = JSON.stringify(input) + '\n';
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(options.signal.reason); return; }
    const child = spawn(command[0], command.slice(1), { env: minimalEnv(env), stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    let stdout = ''; let stderr = ''; let bytes = 0; let failure: unknown;
    const kill = () => { try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch {} };
    const fail = (error: unknown) => { failure ??= error; kill(); };
    const cancel = () => fail(options.signal?.reason ?? new Error('Cancelled'));
    const timer = setTimeout(() => fail(new Error('Command timeout')), options.timeoutMs ?? 60_000);
    options.signal?.addEventListener('abort', cancel, { once: true });
    child.stdout.on('data', (data: Buffer) => { bytes += data.length; if (bytes > (options.maxOutputBytes ?? 4 * 1024 * 1024)) fail(new Error('Command output limit exceeded')); else stdout += data.toString(); });
    child.stderr.on('data', (data: Buffer) => { stderr = (stderr + data.toString()).slice(-8192); });
    child.stdin.on('error', error => fail(error));
    child.on('error', error => { failure ??= error; });
    child.on('close', code => {
      clearTimeout(timer); options.signal?.removeEventListener('abort', cancel);
      if (failure) { reject(failure); return; }
      if (code !== 0) { reject(new Error(`Command exited ${code}: ${stderr}`)); return; }
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error('Command stdout must be one JSON value')); }
    });
    child.stdin.end(encoded);
  });
}
/** MCP server namespace is exactly binding.id; calls go through the official client. */
export function toMcpServers(connectors: readonly Connector[]): { mcpServers: Record<string, McpServerConfig> } {
  const mcpServers: Record<string, McpServerConfig> = Object.create(null);
  for (const connector of connectors) {
    if (connector.transport !== 'mcp') continue;
    const common = { exposure: 'direct' as const, description: connector.description };
    mcpServers[connector.id] = connector.url
      ? { ...common, url: connector.url, headers: connector.headers }
      : { ...common, command: connector.argv![0], args: connector.argv!.slice(1), env: connector.env };
  }
  return { mcpServers };
}
