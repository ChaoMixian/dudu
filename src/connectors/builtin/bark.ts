import type { BuiltinProvider, BuiltinProviderContext } from '../types';
import { stringCredential } from '../types';

interface BarkTarget { serverUrl: string; deviceKey: string }

export function parseBarkUrl(value: string): BarkTarget {
  const raw = value.trim();
  if (!raw) throw new Error('Bark push URL is required');
  const url = raw.includes('://') ? new URL(raw) : new URL(`https://api.day.app/${raw.replace(/^\/+/, '')}`);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Bark push URL must use HTTP or HTTPS');
  const parts = url.pathname.split('/').filter(Boolean);
  const deviceKey = parts[0]?.trim();
  if (!deviceKey) throw new Error('Bark push URL is missing the device key');
  return { serverUrl: url.origin, deviceKey };
}

function target(ctx: BuiltinProviderContext): BarkTarget {
  return parseBarkUrl(stringCredential(ctx.credentials, 'pushUrl', 'Bark push URL'));
}

async function sendBark(ctx: BuiltinProviderContext, body: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  const { serverUrl, deviceKey } = target(ctx);
  const response = await fetch(`${serverUrl}/push`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ device_key: deviceKey, ...body }),
    signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(15_000)]),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Bark returned HTTP ${response.status}: ${text.slice(0, 300)}`);
  let payload: any = null;
  try { payload = JSON.parse(text); } catch { /* Bark returns JSON; fall back to the raw body. */ }
  if (payload && typeof payload.code === 'number' && payload.code !== 200) throw new Error(`Bark rejected the notification: ${payload.message ?? payload.code}`);
  return { ok: true, serverUrl, response: payload ?? text.slice(0, 300) };
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  return typeof args[key] === 'string' && args[key].trim() ? args[key].trim() : undefined;
}

export const barkProvider: BuiltinProvider = {
  id: 'bark',
  name: 'Bark',
  description: '发送 Bark / iOS 推送。',
  descriptionEn: 'Send Bark or iOS push notifications.',
  category: 'notify',
  fields: [
    {
      key: 'pushUrl',
      label: '推送地址',
      labelEn: 'Push URL',
      type: 'password',
      required: true,
      placeholder: 'https://api.day.app/your-key',
      help: '从 Bark App 复制推送地址；dudu 会自动解析服务器和设备 Key。',
      helpEn: 'Copy the push URL from the Bark app. The server URL and device key are parsed from it.',
    },
  ],
  tools: [
    {
      name: 'send',
      description: 'Send a push notification to the configured Bark device. Use this for reminders, alerts, and results the user should see away from dudu.',
      parameters: {
        type: 'object',
        properties: {
          body: { type: 'string', description: 'Notification body' },
          title: { type: 'string', description: 'Optional title' },
          url: { type: 'string', description: 'Optional URL opened when the notification is tapped' },
          group: { type: 'string', description: 'Optional notification group' },
          sound: { type: 'string', description: 'Optional Bark sound name' },
          level: { type: 'string', description: 'Optional interruption level: active, timeSensitive, or passive' },
        },
        required: ['body'],
      },
    },
  ],
  normalize(_settings, credentials) {
    const pushUrl = stringCredential(credentials, 'pushUrl', 'Bark push URL');
    parseBarkUrl(pushUrl);
    return { settings: {}, credentials: { pushUrl } };
  },
  async test(ctx, options) {
    return sendBark(ctx, { title: 'dudu', body: 'Bark connector test notification', group: 'dudu' }, options.signal);
  },
  async call(tool, args, ctx, options) {
    if (tool !== 'send') throw new Error(`Unknown Bark tool: ${tool}`);
    const body = optionalString(args, 'body');
    if (!body) throw new Error('body is required');
    return sendBark(ctx, {
      body,
      ...(optionalString(args, 'title') ? { title: optionalString(args, 'title') } : {}),
      ...(optionalString(args, 'url') ? { url: optionalString(args, 'url') } : {}),
      ...(optionalString(args, 'group') ? { group: optionalString(args, 'group') } : {}),
      ...(optionalString(args, 'sound') ? { sound: optionalString(args, 'sound') } : {}),
      ...(optionalString(args, 'level') ? { level: optionalString(args, 'level') } : {}),
    }, options.signal);
  },
};
