import { createDAVClient, type DAVCalendar, type DAVCalendarObject } from 'tsdav';
import type { BuiltinProvider, BuiltinProviderContext } from '../types';
import { optionalStringSetting, stringCredential, stringSetting } from '../types';
import { buildEventIcs, parseCalendarEvents, patchEventIcs, type EventInput } from '../calendar/ics';

async function client(ctx: BuiltinProviderContext) {
  const preset = optionalStringSetting(ctx.settings, 'preset') ?? 'custom';
  const serverUrl = preset === 'icloud' ? 'https://caldav.icloud.com' : stringSetting(ctx.settings, 'serverUrl', 'CalDAV server URL');
  const username = stringSetting(ctx.settings, 'username', 'CalDAV username');
  const password = stringCredential(ctx.credentials, 'password', 'CalDAV app password');
  return createDAVClient({
    serverUrl,
    credentials: { username, password },
    authMethod: 'Basic',
    defaultAccountType: 'caldav',
  });
}

async function calendars(ctx: BuiltinProviderContext): Promise<DAVCalendar[]> {
  const dav = await client(ctx);
  const list = await dav.fetchCalendars();
  return list.filter(calendar => !calendar.components || calendar.components.includes('VEVENT'));
}

function calendarSummary(calendar: DAVCalendar) {
  return {
    id: calendar.url,
    name: typeof calendar.displayName === 'string' ? calendar.displayName : calendar.url,
    description: typeof calendar.description === 'string' ? calendar.description : undefined,
    components: calendar.components,
  };
}

async function selectedCalendar(ctx: BuiltinProviderContext, calendarId?: string): Promise<DAVCalendar> {
  const list = await calendars(ctx);
  const wanted = calendarId ?? optionalStringSetting(ctx.settings, 'calendarUrl');
  if (wanted) {
    const found = list.find(calendar => calendar.url === wanted);
    if (!found) throw new Error('Calendar not found; run list_calendars again');
    return found;
  }
  if (list.length === 1) return list[0]!;
  const firstEventCalendar = list.find(calendar => !calendar.components || calendar.components.includes('VEVENT'));
  if (firstEventCalendar) return firstEventCalendar;
  throw new Error('No writable calendar found; run list_calendars and pass calendarId');
}

function dateArg(args: Record<string, unknown>, key: string, fallback?: Date): Date {
  const value = args[key];
  if (typeof value === 'string' && value.trim()) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw new Error(`${key} must be an ISO date or date-time`);
    return date;
  }
  if (fallback) return fallback;
  throw new Error(`${key} is required`);
}

function optionalArg(args: Record<string, unknown>, key: string): string | undefined {
  return typeof args[key] === 'string' && args[key].trim() ? args[key].trim() : undefined;
}

function stringArg(args: Record<string, unknown>, key: string): string {
  const value = optionalArg(args, key);
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function eventInput(args: Record<string, unknown>, partial = false): Partial<EventInput> {
  const input: Partial<EventInput> = {};
  if (!partial || args.summary !== undefined) input.summary = stringArg(args, 'summary');
  if (!partial || args.start !== undefined) input.start = stringArg(args, 'start');
  if (!partial || args.end !== undefined) input.end = stringArg(args, 'end');
  if (args.allDay !== undefined) input.allDay = args.allDay === true;
  if (args.description !== undefined) input.description = typeof args.description === 'string' ? args.description : '';
  if (args.location !== undefined) input.location = typeof args.location === 'string' ? args.location : '';
  if (args.rrule !== undefined) input.rrule = typeof args.rrule === 'string' ? args.rrule : '';
  if (args.reminderMinutes !== undefined && Number.isFinite(Number(args.reminderMinutes))) input.reminderMinutes = Math.max(1, Math.round(Number(args.reminderMinutes)));
  return input;
}

async function objectFor(dav: Awaited<ReturnType<typeof client>>, calendar: DAVCalendar, eventId: string): Promise<DAVCalendarObject> {
  let url: URL;
  try { url = new URL(eventId); } catch { throw new Error('eventId must be a full calendar object URL returned by list_events'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('eventId must use HTTP or HTTPS');
  const objects = await dav.fetchCalendarObjects({ calendar, objectUrls: [eventId], useMultiGet: false });
  const object = objects.find(item => item.url === eventId) ?? objects[0];
  if (!object?.data) throw new Error('Calendar event not found; run list_events again');
  return object;
}

export const caldavProvider: BuiltinProvider = {
  id: 'caldav',
  name: 'CalDAV',
  description: '读写 iCloud 或标准 CalDAV 日历。',
  descriptionEn: 'Read and write iCloud or standard CalDAV calendars.',
  category: 'calendar',
  fields: [
    { key: 'preset', label: '服务商', labelEn: 'Provider', type: 'select', defaultValue: 'icloud', options: [{ value: 'icloud', label: 'iCloud' }, { value: 'custom', label: '自定义 CalDAV' }] },
    { key: 'serverUrl', label: '服务器地址', labelEn: 'Server URL', type: 'url', placeholder: 'https://caldav.example.com', help: 'iCloud 会自动使用 https://caldav.icloud.com。', helpEn: 'iCloud uses https://caldav.icloud.com automatically.', visibleWhen: { key: 'preset', equals: 'custom' } },
    { key: 'username', label: '用户名', labelEn: 'Username', type: 'text', required: true, placeholder: 'Apple ID 或 CalDAV 用户名' },
    { key: 'password', label: 'App 专用密码', labelEn: 'App password', type: 'password', required: true, help: '使用 App 专用密码，不要填主账号密码。', helpEn: 'Use an app-specific password, not your main account password.' },
    { key: 'calendarUrl', label: '默认日历', labelEn: 'Default calendar', type: 'text', help: '可选；测试连接后从这里选择，或让 Bot 自动选择。', helpEn: 'Optional; choose one after testing, or let the bot choose.' },
  ],
  tools: [
    { name: 'list_calendars', description: 'List the calendars available to this CalDAV account.', parameters: { type: 'object', properties: {} } },
    { name: 'list_events', description: 'List calendar events in a time range. Returns event IDs that can be used with update_event and delete_event.', parameters: { type: 'object', properties: { from: { type: 'string', description: 'ISO start of the range; defaults to now' }, to: { type: 'string', description: 'ISO end of the range; defaults to 7 days from now' }, calendarId: { type: 'string', description: 'Calendar URL from list_calendars; defaults to the configured calendar' } } } },
    { name: 'create_event', description: 'Create a calendar event. Use ISO date-time strings for timed events and YYYY-MM-DD for all-day events.', parameters: { type: 'object', properties: { summary: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' }, allDay: { type: 'boolean' }, description: { type: 'string' }, location: { type: 'string' }, rrule: { type: 'string', description: 'Optional RFC 5545 RRULE, e.g. FREQ=WEEKLY;BYDAY=MO' }, reminderMinutes: { type: 'integer' }, calendarId: { type: 'string' } }, required: ['summary', 'start', 'end'] } },
    { name: 'update_event', description: 'Update an existing calendar event. Only supplied fields change.', parameters: { type: 'object', properties: { eventId: { type: 'string' }, calendarId: { type: 'string' }, summary: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' }, allDay: { type: 'boolean' }, description: { type: 'string' }, location: { type: 'string' }, rrule: { type: 'string' } }, required: ['eventId'] } },
    { name: 'delete_event', description: 'Delete an existing calendar event.', parameters: { type: 'object', properties: { eventId: { type: 'string' }, calendarId: { type: 'string' } }, required: ['eventId'] } },
  ],
  normalize(settings, credentials) {
    const preset = optionalStringSetting(settings, 'preset') === 'custom' ? 'custom' : 'icloud';
    const serverUrl = preset === 'icloud' ? 'https://caldav.icloud.com' : stringSetting(settings, 'serverUrl', 'CalDAV server URL');
    let parsed: URL;
    try { parsed = new URL(serverUrl); } catch { throw new Error('CalDAV server URL is invalid'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('CalDAV server URL must use HTTP or HTTPS');
    const username = stringSetting(settings, 'username', 'CalDAV username');
    const password = stringCredential(credentials, 'password', 'CalDAV app password');
    const calendarUrl = optionalStringSetting(settings, 'calendarUrl');
    return {
      settings: {
        preset,
        serverUrl: parsed.toString().replace(/\/+$/, ''),
        username,
        ...(calendarUrl ? { calendarUrl } : {}),
        ...(optionalStringSetting(settings, 'calendarName') ? { calendarName: optionalStringSetting(settings, 'calendarName') } : {}),
      },
      credentials: { password },
    };
  },
  async test(ctx) {
    const list = await calendars(ctx);
    return { ok: true, calendars: list.map(calendarSummary) };
  },
  async call(tool, args, ctx) {
    if (tool === 'list_calendars') {
      const list = await calendars(ctx);
      return { calendars: list.map(calendarSummary) };
    }
    const dav = await client(ctx);
    if (tool === 'list_events') {
      const from = dateArg(args, 'from', new Date(Date.now() - 86_400_000));
      const to = dateArg(args, 'to', new Date(Date.now() + 7 * 86_400_000));
      if (to <= from) throw new Error('to must be after from');
      const wanted = optionalArg(args, 'calendarId');
      const list = wanted ? [await selectedCalendar(ctx, wanted)] : (await calendars(ctx)).slice(0, 12);
      const events = [];
      for (const calendar of list) {
        const objects = await dav.fetchCalendarObjects({ calendar, timeRange: { start: from.toISOString(), end: to.toISOString() }, expand: false });
        for (const object of objects) {
          if (typeof object.data !== 'string') continue;
          for (const event of parseCalendarEvents(object.data, from, to)) {
            events.push({ ...event, id: object.url, calendarId: calendar.url, calendarName: calendarSummary(calendar).name, etag: object.etag });
          }
        }
      }
      return { from: from.toISOString(), to: to.toISOString(), events: events.sort((a, b) => a.start.localeCompare(b.start)) };
    }
    if (tool === 'create_event') {
      const calendar = await selectedCalendar(ctx, optionalArg(args, 'calendarId'));
      const input = eventInput(args) as EventInput;
      const uid = crypto.randomUUID();
      const response = await dav.createCalendarObject({ calendar, iCalString: buildEventIcs(input, uid), filename: `${uid}.ics` });
      if (!response.ok) throw new Error(`CalDAV create failed: HTTP ${response.status}`);
      return { ok: true, uid, calendarId: calendar.url };
    }
    if (tool === 'update_event') {
      const eventId = stringArg(args, 'eventId');
      const calendar = await selectedCalendar(ctx, optionalArg(args, 'calendarId'));
      const object = await objectFor(dav, calendar, eventId);
      const patch = eventInput(args, true);
      if (!Object.keys(patch).length) throw new Error('No fields to update');
      const response = await dav.updateCalendarObject({ calendarObject: { ...object, data: patchEventIcs(String(object.data), patch) } });
      if (!response.ok) throw new Error(`CalDAV update failed: HTTP ${response.status}`);
      return { ok: true, eventId, calendarId: calendar.url };
    }
    if (tool === 'delete_event') {
      const eventId = stringArg(args, 'eventId');
      const calendar = await selectedCalendar(ctx, optionalArg(args, 'calendarId'));
      const object = await objectFor(dav, calendar, eventId);
      const response = await dav.deleteCalendarObject({ calendarObject: object });
      if (!response.ok) throw new Error(`CalDAV delete failed: HTTP ${response.status}`);
      return { ok: true, eventId };
    }
    throw new Error(`Unknown CalDAV tool: ${tool}`);
  },
};
