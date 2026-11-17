import { lstat, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve, sep } from 'node:path';
import type { ConfigStore } from './config';
import type { UploadedWorkspaceFile, WorkspaceEntry } from '../contracts';
import { mimeFor } from './attachments';

const MAX_UPLOAD = 50 * 1024 * 1024;
const MAX_LIST = 500;
const DIR_ROOTS = new Set(['work', 'artifacts']);
const FILE_ROOTS = new Set(['BOTS.md', 'MEMORY.md']);

/** Paths the web file manager may see; everything else stays private. */
function cleanRelative(value: unknown): string {
  if (typeof value !== 'string' || value.includes('\0') || value.startsWith('/') || value.startsWith('\\')) throw new Error('Invalid path');
  const parts = value.replaceAll('\\', '/').split('/').filter(part => part && part !== '.');
  if (parts.some(part => part === '..')) throw new Error('Invalid path');
  return parts.join('/');
}

async function resolveEntry(config: ConfigStore, botId: string, value: unknown, allowMissing = false) {
  const rel = cleanRelative(value);
  const root = config.botPath(botId);
  const target = resolve(root, rel);
  if (target !== root && !target.startsWith(root + sep)) throw new Error('Invalid path');
  if (target !== root) {
    const first = rel.split('/')[0]!;
    if (!DIR_ROOTS.has(first) && !FILE_ROOTS.has(rel)) throw new Error('Path is not visible');
  }
  let cursor = root;
  const parts = rel ? rel.split('/') : [];
  for (const [index, part] of parts.entries()) {
    cursor = join(cursor, part);
    const info = await lstat(cursor).catch((error: any) => {
      if (error?.code === 'ENOENT' && allowMissing && index === parts.length - 1) return null;
      throw new Error(error?.code === 'ENOENT' ? 'Path not found' : 'Cannot read path');
    });
    if (!info) break;
    if (info.isSymbolicLink()) throw new Error('Symlinks are not allowed');
  }
  return { root, rel, target };
}

function typeOf(info: Awaited<ReturnType<typeof lstat>>): WorkspaceEntry['type'] {
  if (info.isSymbolicLink()) return 'symlink';
  if (info.isDirectory()) return 'dir';
  if (info.isFile()) return 'file';
  return 'other';
}

function entryOf(name: string, path: string, info: Awaited<ReturnType<typeof lstat>>): WorkspaceEntry {
  return { name, path, type: typeOf(info), size: info.isFile() ? Number(info.size) : 0, mtime: info.mtime.toISOString(), mime: info.isFile() ? mimeFor(name) : '' };
}

function safeName(value: string): string {
  const name = basename(value.replaceAll('\\', '/')).replace(/[\x00-\x1f\x7f]+/g, '-').trim().slice(0, 180);
  return name && name !== '.' && name !== '..' ? name : 'file';
}

async function uniqueName(dir: string, name: string): Promise<string> {
  const extension = extname(name);
  const stem = extension ? name.slice(0, -extension.length) : name;
  for (let index = 0; index < 1000; index++) {
    const candidate = index ? `${stem}-${index}${extension}` : name;
    if (!await lstat(join(dir, candidate)).then(() => true).catch(() => false)) return candidate;
  }
  throw new Error('Could not choose a file name');
}

export async function listWorkspace(config: ConfigStore, botId: string, value: unknown): Promise<WorkspaceEntry[]> {
  const { root, rel, target } = await resolveEntry(config, botId, value);
  if (rel === '') {
    const entries: WorkspaceEntry[] = [];
    for (const name of ['work', 'artifacts', 'BOTS.md', 'MEMORY.md']) {
      const info = await lstat(join(root, name)).catch(() => null);
      if (info) entries.push(entryOf(name, name, info));
    }
    return entries;
  }
  const info = await lstat(target);
  if (!info.isDirectory()) throw new Error('Not a directory');
  const items = (await readdir(target, { withFileTypes: true }))
    .filter(item => item.name !== '.git' && item.name !== '.pi')
    .slice(0, MAX_LIST);
  const entries = await Promise.all(items.map(async item => {
    const info = await lstat(join(target, item.name));
    return entryOf(item.name, rel ? `${rel}/${item.name}` : item.name, info);
  }));
  return entries.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : b.type === 'dir' ? 1 : 0);
}

export async function workspaceFile(config: ConfigStore, botId: string, value: unknown) {
  const { rel, target } = await resolveEntry(config, botId, value);
  if (!rel) throw new Error('Choose a file');
  const info = await lstat(target);
  if (!info.isFile()) throw new Error('Not a regular file');
  if (info.size > MAX_UPLOAD) throw new Error(`File exceeds ${MAX_UPLOAD / 1024 / 1024} MiB`);
  return { name: basename(target), path: rel, size: info.size, mime: mimeFor(target), file: Bun.file(target) };
}

/** Resolve a composer attachment inside the Bot's work directory, without following symlinks. */
export async function workAttachment(config: ConfigStore, botId: string, value: unknown) {
  const root = join(config.botPath(botId), 'work');
  const raw = cleanRelative(value);
  if (!raw) throw new Error('Attachment path is required');
  const absolute = resolve(root, raw);
  if (!absolute.startsWith(root + sep)) throw new Error('Attachment must be inside the Bot work directory');
  let cursor = root;
  const parts = raw.split('/');
  let size = 0;
  for (const [index, part] of parts.entries()) {
    cursor = join(cursor, part);
    const info = await lstat(cursor).catch((error: any) => {
      throw new Error(error?.code === 'ENOENT' ? 'Path not found' : 'Cannot read path');
    });
    if (info.isSymbolicLink()) throw new Error('Symlinks are not allowed');
    if (index < parts.length - 1 && !info.isDirectory()) throw new Error('Not a directory');
    if (index === parts.length - 1) {
      if (!info.isFile()) throw new Error('Attachment is not a regular file');
      size = info.size;
    }
  }
  return { relative: raw, name: basename(absolute), mime: mimeFor(absolute), size };
}

export async function uploadWorkspaceFiles(config: ConfigStore, botId: string, value: unknown, files: File[], options: { ensureDir?: boolean } = {}): Promise<UploadedWorkspaceFile[]> {
  const { rel, target } = await resolveEntry(config, botId, value, options.ensureDir === true);
  let info = await lstat(target).catch(() => null);
  if (!info) {
    if (!options.ensureDir) throw new Error('Path not found');
    await mkdir(target, { recursive: false, mode: 0o700 });
    info = await lstat(target);
  }
  if (!info.isDirectory()) throw new Error('Upload target is not a directory');
  if (!files.length) throw new Error('No files');
  if (files.length > 8) throw new Error('At most 8 files are allowed');
  const uploaded: UploadedWorkspaceFile[] = [];
  for (const file of files) {
    if (!file || typeof file.arrayBuffer !== 'function') continue;
    const name = await uniqueName(target, safeName(file.name || 'file'));
    const data = new Uint8Array(await file.arrayBuffer());
    if (data.length > MAX_UPLOAD) throw new Error(`File exceeds ${MAX_UPLOAD / 1024 / 1024} MiB`);
    await writeFile(join(target, name), data, { mode: 0o600, flag: 'wx' });
    const path = rel ? `${rel}/${name}` : name;
    uploaded.push({ name, path, ...(path.startsWith('work/') ? { workPath: path.slice('work/'.length) } : {}), size: data.length, mime: mimeFor(name) });
  }
  if (!uploaded.length) throw new Error('No files');
  return uploaded;
}

export async function mkdirWorkspace(config: ConfigStore, botId: string, value: unknown) {
  const { rel, target } = await resolveEntry(config, botId, value, true);
  if (!rel) throw new Error('Choose a directory name');
  const parent = await resolveEntry(config, botId, rel.split('/').slice(0, -1).join('/'));
  const info = await lstat(parent.target);
  if (!info.isDirectory()) throw new Error('Parent is not a directory');
  await mkdir(target).catch((error: any) => {
    if (error?.code === 'EEXIST') throw new Error('Path already exists');
    throw new Error('Could not create directory');
  });
  return { path: rel };
}

export async function deleteWorkspace(config: ConfigStore, botId: string, value: unknown, recursive: boolean) {
  const { rel, target } = await resolveEntry(config, botId, value);
  if (!rel || rel === 'work' || rel === 'artifacts') throw new Error('Cannot delete this directory');
  const info = await lstat(target);
  if (info.isDirectory() && !recursive) throw new Error('Set recursive=true for directories');
  await rm(target, { recursive, force: false });
  return { removed: rel };
}
