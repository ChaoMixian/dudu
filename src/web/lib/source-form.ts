import { id, type SourceConfig } from '../../contracts';

export type IntervalUnit = 'minutes' | 'hours' | 'days';
export type SchedulePreset = 'daily' | 'weekdays' | 'weekly';
export interface SourceDraft {
  id: string;
  botId: string;
  kind: SourceConfig['kind'];
  priority: SourceConfig['priority'];
  enabled: boolean;
  task: string;
  at: string;
  intervalValue: string;
  intervalUnit: IntervalUnit;
  schedule: SchedulePreset;
  time: string;
  weekday: string;
  timezone: string;
  executable: string;
  arguments: string[];
  env: { key: string; value: string }[];
  eventType: string;
}

export type SourceDraftIssue = 'id' | 'bot' | 'duplicate' | 'task' | 'once' | 'interval' | 'cron' | 'timezone' | 'process' | 'env' | 'type';
export class SourceDraftError extends Error {
  constructor(readonly issue: SourceDraftIssue) { super(issue); this.name = 'SourceDraftError'; }
}
const invalid = (issue: SourceDraftIssue): never => { throw new SourceDraftError(issue); };
const milliseconds: Record<IntervalUnit, number> = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 };

export function emptySourceDraft(): SourceDraft {
  return {
    id: '', botId: '', kind: 'interval', priority: 'normal', enabled: true, task: '', at: '',
    intervalValue: '1', intervalUnit: 'hours', schedule: 'daily', time: '09:00', weekday: '1',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', executable: '', arguments: [], env: [],
    eventType: 'source.webhook',
  };
}

/** datetime-local is intentionally interpreted in the browser's local zone, never as UTC. */
export function localDateToIso(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return invalid('once');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return invalid('once');
  const [year, month, day, hour, minute] = value.split(/\D/).map(Number);
  // Reject normalized invalid calendar dates and nonexistent local times at DST changes.
  if (date.getFullYear() !== year || date.getMonth() + 1 !== month || date.getDate() !== day || date.getHours() !== hour || date.getMinutes() !== minute) return invalid('once');
  return date.toISOString();
}

export function sourceFromDraft(draft: SourceDraft, botIds: Iterable<string>, existingIds: Iterable<string>): SourceConfig {
  try { id(draft.id); } catch { return invalid('id'); }
  if (new Set(existingIds).has(draft.id)) return invalid('duplicate');
  if (!new Set(botIds).has(draft.botId)) return invalid('bot');
  try { id(draft.botId); } catch { return invalid('bot'); }
  if (!draft.task.trim()) return invalid('task');
  const source: SourceConfig = {
    id: draft.id, botId: draft.botId, kind: draft.kind, enabled: draft.enabled, priority: draft.priority,
    payload: { task: draft.task.trim() },
  };
  switch (draft.kind) {
    case 'once': source.at = localDateToIso(draft.at); break;
    case 'interval': {
      const value = Number(draft.intervalValue);
      const interval = value * milliseconds[draft.intervalUnit];
      if (!draft.intervalValue.trim() || !Number.isFinite(value) || value <= 0 || !Number.isSafeInteger(interval) || interval < 10) return invalid('interval');
      source.intervalMs = interval;
      break;
    }
    case 'cron': {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.time) || !['daily', 'weekdays', 'weekly'].includes(draft.schedule)) return invalid('cron');
      if (draft.schedule === 'weekly' && !/^[0-6]$/.test(draft.weekday)) return invalid('cron');
      const timezone = draft.timezone.trim();
      if (!timezone) return invalid('timezone');
      try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(0); } catch { return invalid('timezone'); }
      const [hour, minute] = draft.time.split(':').map(Number);
      source.cron = `${minute} ${hour} * * ${draft.schedule === 'daily' ? '*' : draft.schedule === 'weekdays' ? '1-5' : draft.weekday}`;
      source.timezone = timezone;
      break;
    }
    case 'process': {
      const executable = draft.executable.trim();
      if (!executable || [executable, ...draft.arguments].some(value => value.includes('\0'))) return invalid('process');
      source.argv = [executable, ...draft.arguments];
      const env: Record<string, string> = {};
      for (const row of draft.env) {
        const key = row.key.trim();
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || Object.hasOwn(env, key) || row.value.includes('\0')) return invalid('env');
        Object.defineProperty(env, key, { value: row.value, enumerable: true, configurable: true, writable: true });
      }
      if (draft.env.length) source.env = env;
      break;
    }
    case 'webhook':
      if (!draft.eventType.trim() || draft.eventType.includes('\0')) return invalid('type');
      source.type = draft.eventType.trim();
      break;
  }
  return source;
}
