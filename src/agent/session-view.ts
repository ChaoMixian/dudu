import { join } from 'node:path';
import type { ConfigStore } from '../core/config';

const HISTORY_WINDOW_BYTES = 256 * 1024;
const HISTORY_SCAN_BYTES = 4 * 1024 * 1024;
const MAX_STRING = 64 * 1024;
const MAX_FRAME = 256 * 1024;

export interface SessionHistoryPage { entries: unknown[]; cursor: number; hasMore: boolean }

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[depth]';
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 200).map(item => sanitizeValue(item, depth + 1));
  const record = value as Record<string, unknown>;
  if (record.type === 'image' && typeof record.data === 'string') {
    return { ...record, data: `[image ${Math.round(record.data.length * 3 / 4)} bytes]` };
  }
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(record).slice(0, 120)) output[key] = sanitizeValue(item, depth + 1);
  return output;
}

/** Keep session frames bounded: screenshots and long tool output must not flood the stream. */
export function sanitizeSessionEvent(event: unknown): unknown {
  let clean: unknown;
  let text: string;
  try {
    clean = sanitizeValue(event);
    text = JSON.stringify(clean) ?? 'null';
  } catch {
    return { type: 'event.unserializable', originalType: (event as { type?: string } | null)?.type ?? null };
  }
  if (text.length > MAX_FRAME) return { type: 'event.truncated', originalType: (event as { type?: string } | null)?.type ?? null, bytes: text.length };
  return clean;
}

/**
 * Read one page of the Pi session JSONL. The cursor is a byte offset: call again
 * with `before=cursor` to walk backwards without reading the whole file.
 */
export async function readSessionHistory(config: ConfigStore, botId: string, before?: number): Promise<SessionHistoryPage> {
  const file = Bun.file(join(config.botPath(botId), '.pi', 'session.jsonl'));
  if (!await file.exists()) return { entries: [], cursor: 0, hasMore: false };
  const size = file.size;
  const end = before === undefined ? size : Math.max(0, Math.min(before, size));
  if (!end) return { entries: [], cursor: 0, hasMore: false };
  const start = Math.max(0, end - HISTORY_WINDOW_BYTES);
  const chunk = new Uint8Array(await file.slice(start, end).arrayBuffer());
  const decoder = new TextDecoder();
  const parse = (body: Uint8Array): unknown[] => {
    const entries: unknown[] = [];
    for (const line of decoder.decode(body).split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as { type?: string };
        if (entry.type === 'session') continue;
        entries.push(sanitizeSessionEvent(entry));
      } catch { /* skip malformed lines */ }
    }
    return entries;
  };
  let cursor = 0;
  let entries: unknown[] = start === 0 ? parse(chunk) : [];
  if (start > 0) {
    // Start after the first newline: string indices are UTF-16 units, not file
    // offsets. If this leaves no complete event, the window sat inside one
    // oversized event (for example a screenshot); widen to that line's start.
    const newline = chunk.indexOf(10);
    if (newline >= 0) {
      cursor = start + newline + 1;
      entries = parse(chunk.subarray(newline + 1));
    }
    if (!entries.length) {
      const scanStart = Math.max(0, start - HISTORY_SCAN_BYTES);
      const scan = new Uint8Array(await file.slice(scanStart, start).arrayBuffer());
      const previousLine = scan.lastIndexOf(10);
      if (previousLine >= 0) {
        cursor = scanStart + previousLine + 1;
        entries = parse(new Uint8Array(await file.slice(cursor, end).arrayBuffer()));
      } else if (start <= HISTORY_SCAN_BYTES) {
        // The oversized line starts at byte 0; it is the only event in range.
        cursor = 0;
        entries = parse(new Uint8Array(await file.slice(0, end).arrayBuffer()));
      }
    }
    if (!entries.length) return { entries: [], cursor: 0, hasMore: false };
  }
  return { entries, cursor, hasMore: cursor > 0 };
}
