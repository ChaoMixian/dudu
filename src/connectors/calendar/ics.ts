import * as ical from 'node-ical';

export interface EventInput {
  summary: string;
  start: string;
  end: string;
  allDay?: boolean;
  description?: string;
  location?: string;
  rrule?: string;
  reminderMinutes?: number;
}

export interface CalendarEvent {
  id: string;
  uid: string;
  calendarId: string;
  calendarName?: string;
  summary: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  description?: string;
  recurring?: boolean;
  etag?: string;
}

function stringValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'val' in value) return String((value as { val: unknown }).val ?? '');
  return value == null ? '' : String(value);
}

function escapeText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
}

function unfold(raw: string): string[] {
  return raw.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
}

function dateOnly(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (match) return `${match[1]}${match[2]}${match[3]}`;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid date: ${value}`);
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`;
}

function utcStamp(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid date: ${value}`);
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

function lineDate(name: string, value: string, allDay: boolean): string {
  return allDay || isDateOnly(value) ? `${name};VALUE=DATE:${dateOnly(value)}` : `${name}:${utcStamp(value)}`;
}

function propertyLines(input: EventInput, uid: string): string[] {
  const allDay = input.allDay === true || (isDateOnly(input.start) && isDateOnly(input.end));
  const lines = [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${utcStamp(new Date().toISOString())}`,
    lineDate('DTSTART', input.start, allDay),
    lineDate('DTEND', input.end, allDay),
    `SUMMARY:${escapeText(input.summary)}`,
  ];
  if (input.description) lines.push(`DESCRIPTION:${escapeText(input.description)}`);
  if (input.location) lines.push(`LOCATION:${escapeText(input.location)}`);
  if (input.rrule) lines.push(`RRULE:${input.rrule.trim()}`);
  if (input.reminderMinutes && input.reminderMinutes > 0) {
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(input.summary)}`, `TRIGGER:-PT${Math.round(input.reminderMinutes)}M`, 'END:VALARM');
  }
  lines.push('END:VEVENT');
  return lines;
}

export function buildEventIcs(input: EventInput, uid: string = crypto.randomUUID()): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//dudu//Calendar//EN', 'CALSCALE:GREGORIAN', ...propertyLines(input, uid), 'END:VCALENDAR', ''].join('\r\n');
}

/** Patch the master VEVENT in place so alarms, attendees and extensions survive an edit. */
export function patchEventIcs(raw: string, patch: Partial<EventInput>): string {
  const lines = unfold(raw);
  const begin = lines.findIndex(line => line.trim().toUpperCase() === 'BEGIN:VEVENT');
  const end = begin >= 0 ? lines.findIndex((line, index) => index > begin && line.trim().toUpperCase() === 'END:VEVENT') : -1;
  if (begin < 0 || end < 0) throw new Error('Calendar object does not contain a VEVENT');
  const block = lines.slice(begin + 1, end);
  const remove = new Set<string>();
  if (patch.summary !== undefined) remove.add('SUMMARY');
  if (patch.description !== undefined) remove.add('DESCRIPTION');
  if (patch.location !== undefined) remove.add('LOCATION');
  if (patch.start !== undefined) { remove.add('DTSTART'); remove.add('DURATION'); }
  if (patch.end !== undefined) { remove.add('DTEND'); remove.add('DURATION'); }
  if (patch.rrule !== undefined) remove.add('RRULE');
  const kept = block.filter(line => !remove.has(line.split(/[;:]/, 1)[0]!.toUpperCase()));
  const allDay = patch.allDay === true || (patch.start !== undefined && patch.end !== undefined && isDateOnly(patch.start) && isDateOnly(patch.end));
  const additions: string[] = [];
  if (patch.start !== undefined) additions.push(lineDate('DTSTART', patch.start, allDay));
  if (patch.end !== undefined) additions.push(lineDate('DTEND', patch.end, allDay));
  if (patch.summary !== undefined) additions.push(`SUMMARY:${escapeText(patch.summary)}`);
  if (patch.description !== undefined) additions.push(`DESCRIPTION:${escapeText(patch.description)}`);
  if (patch.location !== undefined) additions.push(`LOCATION:${escapeText(patch.location)}`);
  if (patch.rrule !== undefined) additions.push(`RRULE:${patch.rrule.trim()}`);
  return [...lines.slice(0, begin + 1), ...kept, ...additions, ...lines.slice(end)].join('\r\n');
}

function overlaps(start: Date, end: Date, from: Date, to: Date): boolean {
  return end > from && start < to;
}

function eventDate(value: unknown): Date | undefined {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value : undefined;
}

function formatDate(value: Date, allDay: boolean): string {
  return allDay ? value.toISOString().slice(0, 10) : value.toISOString();
}

export function parseCalendarEvents(raw: string, from: Date, to: Date): Array<Omit<CalendarEvent, 'id' | 'calendarId' | 'calendarName' | 'etag'>> {
  const parsed = ical.sync.parseICS(raw);
  const result: Array<Omit<CalendarEvent, 'id' | 'calendarId' | 'calendarName' | 'etag'>> = [];
  for (const value of Object.values(parsed)) {
    if (!value || typeof value !== 'object') continue;
    const event = value as unknown as ical.VEvent;
    if (event.type !== 'VEVENT' || event.status === 'CANCELLED') continue;
    const allDay = event.datetype === 'date';
    const base = {
      uid: event.uid ?? '',
      summary: stringValue(event.summary),
      allDay,
      ...(stringValue(event.location) ? { location: stringValue(event.location) } : {}),
      ...(stringValue(event.description) ? { description: stringValue(event.description) } : {}),
      ...(event.rrule ? { recurring: true } : {}),
    };
    if (event.rrule) {
      const instances = ical.expandRecurringEvent(event, { from, to, includeOverrides: true, excludeExdates: true });
      for (const instance of instances) {
        if (!overlaps(instance.start, instance.end, from, to)) continue;
        result.push({
          ...base,
          summary: stringValue(instance.summary) || base.summary,
          start: formatDate(instance.start, instance.isFullDay),
          end: formatDate(instance.end, instance.isFullDay),
          allDay: instance.isFullDay,
        });
      }
      continue;
    }
    const start = eventDate(event.start);
    const end = eventDate(event.end) ?? start;
    if (!start || !end || !overlaps(start, end, from, to)) continue;
    result.push({ ...base, start: formatDate(start, allDay), end: formatDate(end, allDay) });
  }
  return result.sort((a, b) => a.start.localeCompare(b.start));
}

export function parseIcsSummary(raw: string): { uid?: string; summary?: string; start?: Date; end?: Date } {
  const parsed = ical.sync.parseICS(raw);
  for (const value of Object.values(parsed)) {
    if (!value || typeof value !== 'object') continue;
    const event = value as unknown as ical.VEvent;
    if (event.type !== 'VEVENT') continue;
    return { uid: event.uid, summary: stringValue(event.summary), start: eventDate(event.start), end: eventDate(event.end) };
  }
  return {};
}
