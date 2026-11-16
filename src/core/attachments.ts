import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import { basename, extname, join, resolve, sep } from 'node:path';
import type { ConfigStore } from './config';
import type { MessageAttachment } from '../contracts';

const MAX_FILES = 8;
const MAX_BYTES = 50 * 1024 * 1024;

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.avif': 'image/avif',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.flac': 'audio/flac',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv', '.tsv': 'text/tab-separated-values',
  '.json': 'application/json', '.jsonl': 'application/x-ndjson', '.xml': 'application/xml',
  '.yaml': 'application/yaml', '.yml': 'application/yaml', '.toml': 'application/toml',
  '.html': 'text/plain', '.css': 'text/plain', '.js': 'text/plain', '.mjs': 'text/plain',
  '.ts': 'text/plain', '.tsx': 'text/plain', '.jsx': 'text/plain', '.py': 'text/plain',
  '.sh': 'text/plain', '.sql': 'text/plain', '.log': 'text/plain',
  '.zip': 'application/zip', '.tar': 'application/x-tar', '.gz': 'application/gzip', '.7z': 'application/x-7z-compressed',
};

export interface AttachmentInput { path?: unknown; name?: unknown }

/** MIME type for a file name; the shared fallback is application/octet-stream. */
export function mimeFor(name: string): string {
  return MIME[extname(name).toLowerCase()] ?? 'application/octet-stream';
}

function storageName(display: string, source: string): string {
  const extension = extname(display) || extname(source);
  const safe = basename(display).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(-80);
  return safe || `file${extension}`;
}

/** Copy files into the bot's own artifacts directory and return auth-protected URLs. */
export function saveAttachments(config: ConfigStore, botId: string, inputs: AttachmentInput[]): MessageAttachment[] {
  if (inputs.length > MAX_FILES) throw new Error(`At most ${MAX_FILES} attachments are allowed`);
  const root = config.botPath(botId);
  const artifacts = join(root, 'artifacts');
  mkdirSync(artifacts, { recursive: true });
  return inputs.map(input => {
    const raw = typeof input.path === 'string' ? input.path.trim() : '';
    if (!raw) throw new Error('Attachment path is required');
    const source = resolve(raw.startsWith('/') ? raw : join(root, 'work'), raw);
    if (!source.startsWith(root + sep)) throw new Error('Attachment must be inside the bot workspace');
    const stat = statSync(source);
    if (!stat.isFile()) throw new Error(`Attachment is not a regular file: ${raw}`);
    if (stat.size > MAX_BYTES) throw new Error(`Attachment exceeds ${MAX_BYTES / 1024 / 1024} MiB: ${raw}`);
    const display = (typeof input.name === 'string' && input.name.trim() ? input.name.trim() : basename(source)).slice(0, 200);
    const storage = `${crypto.randomUUID()}-${storageName(display, source)}`;
    const mime = mimeFor(display) === 'application/octet-stream' ? mimeFor(source) : mimeFor(display);
    copyFileSync(source, join(artifacts, storage));
    return {
      id: crypto.randomUUID(),
      name: display,
      mime,
      size: stat.size,
      url: `/api/artifacts/${botId}/${storage}`,
    };
  });
}
