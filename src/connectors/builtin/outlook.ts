import type { BuiltinProvider, BuiltinProviderContext } from '../types';
import { optionalStringSetting } from '../types';

const GRAPH = 'https://graph.microsoft.com/v1.0';
const DEFAULT_SCOPE = 'offline_access Calendars.ReadWrite User.Read';
/** Public client registered by dudu. Device-code sign-in needs no secret or redirect URI. */
export const DEFAULT_MICROSOFT_CLIENT_ID = 'aaca87d9-568c-48b3-8a95-768f508fe1bb';

function clientId(settings?: Record<string, unknown>): string {
  const configured = typeof settings?.clientId === 'string' ? settings.clientId.trim() : '';
  return configured || process.env.DUDU_MICROSOFT_CLIENT_ID?.trim() || DEFAULT_MICROSOFT_CLIENT_ID;
}

function tenant(settings?: Record<string, unknown>): string {
  const configured = typeof settings?.tenant === 'string' ? settings.tenant.trim() : '';
  return configured || process.env.DUDU_MICROSOFT_TENANT?.trim() || 'common';
}

function timeout(signal?: AbortSignal): AbortSignal {
  return AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(20_000)]);
}

export interface DeviceStart {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
  message: string;
}

export type DevicePoll =
  | { status: 'pending' | 'slow_down' | 'expired' | 'declined'; message: string }
  | { status: 'connected'; credentials: Record<string, string>; message: string };

export async function startOutlookDevice(settings?: Record<string, unknown>, signal?: AbortSignal): Promise<DeviceStart> {
  const response = await fetch(`https://login.microsoftonline.com/${tenant(settings)}/oauth2/v2.0/devicecode`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId(settings), scope: DEFAULT_SCOPE }),
    signal: timeout(signal),
  });
  const payload: any = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error_description ?? `Microsoft device login failed: HTTP ${response.status}`);
  return {
    deviceCode: String(payload.device_code ?? ''),
    userCode: String(payload.user_code ?? ''),
    verificationUri: String(payload.verification_uri ?? 'https://microsoft.com/devicelogin'),
    expiresIn: Number(payload.expires_in ?? 900),
    interval: Math.max(2, Number(payload.interval ?? 5)),
    message: String(payload.message ?? ''),
  };
}

export async function pollOutlookDevice(deviceCode: string, settings?: Record<string, unknown>, signal?: AbortSignal): Promise<DevicePoll> {
  const response = await fetch(`https://login.microsoftonline.com/${tenant(settings)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      client_id: clientId(settings),
      device_code: deviceCode,
    }),
    signal: timeout(signal),
  });
  const payload: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = String(payload.error ?? '');
    if (code === 'authorization_pending') return { status: 'pending', message: 'Waiting for Microsoft sign-in' };
    if (code === 'slow_down') return { status: 'slow_down', message: 'Microsoft asked to slow down polling' };
    if (code === 'expired_token') return { status: 'expired', message: 'The device code expired; start again' };
    if (code === 'authorization_declined') return { status: 'declined', message: 'Microsoft sign-in was declined' };
    throw new Error(payload.error_description ?? `Microsoft token request failed: HTTP ${response.status}`);
  }
  return {
    status: 'connected',
    credentials: {
      accessToken: String(payload.access_token ?? ''),
      refreshToken: String(payload.refresh_token ?? ''),
      expiresAt: new Date(Date.now() + Number(payload.expires_in ?? 3600) * 1000).toISOString(),
    },
    message: 'Connected to Microsoft',
  };
}

async function refresh(ctx: BuiltinProviderContext, signal?: AbortSignal): Promise<string> {
  const refreshToken = ctx.credentials.refreshToken;
  if (!refreshToken) throw new Error('Outlook is not connected. Open the connector and sign in with Microsoft.');
  const response = await fetch(`https://login.microsoftonline.com/${tenant(ctx.settings)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId(ctx.settings), refresh_token: refreshToken, scope: DEFAULT_SCOPE }),
    signal: timeout(signal),
  });
  const payload: any = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error_description ?? `Microsoft refresh failed: HTTP ${response.status}`);
  const credentials = {
    accessToken: String(payload.access_token ?? ''),
    refreshToken: String(payload.refresh_token ?? refreshToken),
    expiresAt: new Date(Date.now() + Number(payload.expires_in ?? 3600) * 1000).toISOString(),
  };
  ctx.credentials = { ...ctx.credentials, ...credentials };
  ctx.updateCredentials?.(credentials);
  return credentials.accessToken;
}

async function accessToken(ctx: BuiltinProviderContext, signal?: AbortSignal): Promise<string> {
  const token = ctx.credentials.accessToken;
  const expiresAt = Date.parse(ctx.credentials.expiresAt ?? '');
  if (token && Number.isFinite(expiresAt) && expiresAt > Date.now() + 60_000) return token;
  return refresh(ctx, signal);
}

async function graph<T>(ctx: BuiltinProviderContext, path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<T> {
  const token = await accessToken(ctx, signal);
  const response = await fetch(path.startsWith('http') ? path : `${GRAPH}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
    signal: timeout(signal),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Microsoft Graph ${response.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) as T : ({} as T);
}

function graphInstant(value: unknown): string {
  const raw = typeof value === 'string' ? value : '';
  if (!raw) return '';
  const parsed = new Date(raw.endsWith('Z') ? raw : `${raw}Z`);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : raw;
}

function dateOnly(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  if (match) return match[1]!;
  return new Date(value).toISOString().slice(0, 10);
}

function graphTime(value: string, allDay: boolean) {
  return allDay || /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? { dateTime: `${dateOnly(value)}T00:00:00`, timeZone: 'UTC' }
    : { dateTime: new Date(value).toISOString().slice(0, 19), timeZone: 'UTC' };
}

function eventView(raw: any, calendarId?: string) {
  const allDay = raw.isAllDay === true;
  return {
    id: String(raw.id ?? ''),
    calendarId,
    summary: String(raw.subject ?? ''),
    start: allDay ? dateOnly(String(raw.start?.dateTime ?? '')) : graphInstant(raw.start?.dateTime),
    end: allDay ? dateOnly(String(raw.end?.dateTime ?? '')) : graphInstant(raw.end?.dateTime),
    allDay,
    location: raw.location?.displayName ? String(raw.location.displayName) : undefined,
    description: raw.bodyPreview ? String(raw.bodyPreview) : undefined,
    webLink: raw.webLink ? String(raw.webLink) : undefined,
  };
}

async function defaultCalendar(ctx: BuiltinProviderContext, signal?: AbortSignal): Promise<string> {
  const configured = optionalStringSetting(ctx.settings, 'calendarId');
  if (configured) return configured;
  const payload = await graph<{ value?: any[] }>(ctx, '/me/calendars?$select=id,name,isDefaultCalendar,canEdit', {}, signal);
  const list = Array.isArray(payload.value) ? payload.value : [];
  const calendar = list.find(item => item.isDefaultCalendar === true) ?? list.find(item => item.canEdit !== false) ?? list[0];
  if (!calendar?.id) throw new Error('No Outlook calendar found; open the connector and select a calendar.');
  return String(calendar.id);
}

function argString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} is required`);
  return value.trim();
}

function optional(args: Record<string, unknown>, key: string): string | undefined {
  return typeof args[key] === 'string' && args[key].trim() ? args[key].trim() : undefined;
}

export const outlookProvider: BuiltinProvider = {
  id: 'outlook',
  name: 'Outlook',
  description: '读写 Outlook / Microsoft 365 日历。',
  descriptionEn: 'Read and write Outlook and Microsoft 365 calendars.',
  category: 'calendar',
  connect: { kind: 'device-code', credentials: ['refreshToken'] },
  fields: [],
  tools: [
    { name: 'list_calendars', description: 'List Outlook calendars available to this account.', parameters: { type: 'object', properties: {} } },
    { name: 'list_events', description: 'List Outlook events in a time range. Returns event IDs for update_event and delete_event.', parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, calendarId: { type: 'string' } } } },
    { name: 'create_event', description: 'Create an Outlook event. Use ISO date-time strings for timed events and YYYY-MM-DD for all-day events.', parameters: { type: 'object', properties: { summary: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' }, allDay: { type: 'boolean' }, description: { type: 'string' }, location: { type: 'string' }, reminderMinutes: { type: 'integer' }, calendarId: { type: 'string' } }, required: ['summary', 'start', 'end'] } },
    { name: 'update_event', description: 'Update an Outlook event. Only supplied fields change.', parameters: { type: 'object', properties: { eventId: { type: 'string' }, calendarId: { type: 'string' }, summary: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' }, allDay: { type: 'boolean' }, description: { type: 'string' }, location: { type: 'string' } }, required: ['eventId'] } },
    { name: 'delete_event', description: 'Delete an Outlook event.', parameters: { type: 'object', properties: { eventId: { type: 'string' } }, required: ['eventId'] } },
  ],
  normalize(settings, credentials) {
    // Keep clientId/tenant for existing installs and DUDU_MICROSOFT_* overrides; new connectors use the built-in app.
    return {
      settings: {
        ...(optionalStringSetting(settings, 'clientId') ? { clientId: optionalStringSetting(settings, 'clientId') } : {}),
        ...(optionalStringSetting(settings, 'tenant') ? { tenant: optionalStringSetting(settings, 'tenant') } : {}),
        ...(optionalStringSetting(settings, 'calendarId') ? { calendarId: optionalStringSetting(settings, 'calendarId') } : {}),
        ...(optionalStringSetting(settings, 'calendarName') ? { calendarName: optionalStringSetting(settings, 'calendarName') } : {}),
      },
      credentials: {
        ...(credentials.accessToken ? { accessToken: credentials.accessToken } : {}),
        ...(credentials.refreshToken ? { refreshToken: credentials.refreshToken } : {}),
        ...(credentials.expiresAt ? { expiresAt: credentials.expiresAt } : {}),
      },
    };
  },
  async disconnect(ctx) {
    ctx.updateCredentials?.({ accessToken: '', refreshToken: '', expiresAt: '' });
  },
  async test(ctx, options) {
    const payload = await graph<{ value?: any[] }>(ctx, '/me/calendars?$select=id,name,isDefaultCalendar,canEdit', {}, options.signal);
    return { ok: true, calendars: Array.isArray(payload.value) ? payload.value.map(item => ({ id: item.id, name: item.name, default: item.isDefaultCalendar === true, canEdit: item.canEdit !== false })) : [] };
  },
  async call(tool, args, ctx, options) {
    if (tool === 'list_calendars') {
      const payload = await graph<{ value?: any[] }>(ctx, '/me/calendars?$select=id,name,isDefaultCalendar,canEdit', {}, options.signal);
      return { calendars: Array.isArray(payload.value) ? payload.value.map(item => ({ id: item.id, name: item.name, default: item.isDefaultCalendar === true, canEdit: item.canEdit !== false })) : [] };
    }
    if (tool === 'list_events') {
      const from = args.from ? new Date(String(args.from)) : new Date(Date.now() - 86_400_000);
      const to = args.to ? new Date(String(args.to)) : new Date(Date.now() + 7 * 86_400_000);
      if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from) throw new Error('Invalid event range');
      const calendarId = optional(args, 'calendarId') ?? await defaultCalendar(ctx, options.signal);
      const query = new URLSearchParams({ startDateTime: from.toISOString(), endDateTime: to.toISOString(), '$select': 'id,subject,start,end,location,bodyPreview,isAllDay,webLink', '$orderby': 'start/dateTime', '$top': '200' });
      const payload = await graph<{ value?: any[] }>(ctx, `/me/calendars/${encodeURIComponent(calendarId)}/calendarView?${query}`, { headers: { prefer: 'outlook.timezone="UTC"' } }, options.signal);
      return { from: from.toISOString(), to: to.toISOString(), events: (payload.value ?? []).map(item => eventView(item, calendarId)) };
    }
    if (tool === 'create_event') {
      const calendarId = optional(args, 'calendarId') ?? await defaultCalendar(ctx, options.signal);
      const allDay = args.allDay === true || (/^\d{4}-\d{2}-\d{2}$/.test(String(args.start ?? '')) && /^\d{4}-\d{2}-\d{2}$/.test(String(args.end ?? '')));
      const body: Record<string, unknown> = {
        subject: argString(args, 'summary'),
        start: graphTime(argString(args, 'start'), allDay),
        end: graphTime(argString(args, 'end'), allDay),
        isAllDay: allDay,
      };
      if (typeof args.description === 'string' && args.description) body.body = { contentType: 'text', content: args.description };
      if (typeof args.location === 'string' && args.location) body.location = { displayName: args.location };
      if (args.reminderMinutes !== undefined && Number.isFinite(Number(args.reminderMinutes))) {
        body.isReminderOn = true;
        body.reminderMinutesBeforeStart = Math.max(1, Math.round(Number(args.reminderMinutes)));
      }
      const created = await graph<any>(ctx, `/me/calendars/${encodeURIComponent(calendarId)}/events`, { method: 'POST', body: JSON.stringify(body) }, options.signal);
      return { ok: true, event: eventView(created, calendarId) };
    }
    if (tool === 'update_event') {
      const eventId = argString(args, 'eventId');
      const body: Record<string, unknown> = {};
      if (args.summary !== undefined) body.subject = argString(args, 'summary');
      if (args.description !== undefined) body.body = { contentType: 'text', content: String(args.description) };
      if (args.location !== undefined) body.location = { displayName: String(args.location) };
      if (args.start !== undefined || args.end !== undefined || args.allDay !== undefined) {
        const allDay = args.allDay === true;
        if (args.start !== undefined) body.start = graphTime(String(args.start), allDay);
        if (args.end !== undefined) body.end = graphTime(String(args.end), allDay);
        if (args.allDay !== undefined) body.isAllDay = allDay;
      }
      if (!Object.keys(body).length) throw new Error('No fields to update');
      const updated = await graph<any>(ctx, `/me/events/${encodeURIComponent(eventId)}`, { method: 'PATCH', body: JSON.stringify(body) }, options.signal);
      return { ok: true, event: eventView(updated, optional(args, 'calendarId')) };
    }
    if (tool === 'delete_event') {
      const eventId = argString(args, 'eventId');
      await graph(ctx, `/me/events/${encodeURIComponent(eventId)}`, { method: 'DELETE' }, options.signal);
      return { ok: true, eventId };
    }
    throw new Error(`Unknown Outlook tool: ${tool}`);
  },
};
