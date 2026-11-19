import { describe, test, expect } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConnectorRegistry } from '../src/connectors';
import { createBuiltinProviders } from '../src/connectors/builtin';
import { parseBarkUrl, barkProvider } from '../src/connectors/builtin/bark';
import { caldavProvider } from '../src/connectors/builtin/caldav';
import { DEFAULT_MICROSOFT_CLIENT_ID, outlookProvider, startOutlookDevice } from '../src/connectors/builtin/outlook';
import { weatherProvider } from '../src/connectors/builtin/weather';
import { buildEventIcs, parseCalendarEvents, patchEventIcs } from '../src/connectors/calendar/ics';
import { sendWeixinText, WeixinService } from '../src/channels/weixin';
import { SkillStore } from '../src/core/skills';
import { Store } from '../src/core/store';
import { createApp } from '../src/server';
import { DefaultResourceLoader, SettingsManager } from '@earendil-works/pi-coding-agent';

const providers = () => createBuiltinProviders({ weixin: () => undefined });
function fixture() { const root = mkdtempSync(join(tmpdir(), 'dudu-builtin-')); return { root, registry: new ConnectorRegistry(root, providers()), clean: () => rmSync(root, { recursive: true, force: true }) }; }

describe('builtin connector registry', () => {
  test('validates providers, supports instances, masks credentials and removes the instance', () => {
    const f = fixture(); try {
      f.registry.register({ id: 'bark-home', name: 'Bark home', description: 'home', transport: 'builtin', provider: 'bark', settings: {}, credentials: { pushUrl: 'https://api.day.app/home-key' }, tools: [] });
      f.registry.register({ id: 'bark-work', name: 'Bark work', description: 'work', transport: 'builtin', provider: 'bark', settings: {}, credentials: { pushUrl: 'https://api.day.app/work-key' }, tools: [] });
      expect(f.registry.list()).toHaveLength(2);
      const publicList = f.registry.listPublic();
      expect(publicList.map(item => item.id)).toEqual(['bark-home', 'bark-work']);
      expect(publicList[0]!.credentialsSet).toEqual(['pushUrl']);
      expect(JSON.stringify(publicList)).not.toContain('home-key');
      const stored = readFileSync(join(f.root, 'connectors', 'bark-home', 'connector.json'), 'utf8');
      expect(stored).toContain('home-key');
      f.registry.remove('bark-home');
      expect(f.registry.list()).toHaveLength(1);
      expect(existsSync(join(f.root, 'connectors', 'bark-home'))).toBe(false);
    } finally { f.clean(); }
  });

  test('rejects unknown builtin providers and missing required fields', () => {
    const f = fixture(); try {
      expect(() => f.registry.register({ id: 'x', name: 'X', description: '', transport: 'builtin', provider: 'nope', settings: {}, credentials: {}, tools: [] })).toThrow('Unknown builtin provider');
      expect(() => f.registry.register({ id: 'bark', name: 'Bark', description: '', transport: 'builtin', provider: 'bark', settings: {}, credentials: {}, tools: [] })).toThrow('Bark push URL is required');
    } finally { f.clean(); }
  });

  test('catalog exposes sign-in metadata separately from connector fields', () => {
    const f = fixture(); try {
      const catalog = f.registry.catalog();
      expect(catalog.find(item => item.id === 'weixin')?.connect).toEqual({ kind: 'qr', credentials: ['token'] });
      expect(catalog.find(item => item.id === 'outlook')?.connect).toEqual({ kind: 'device-code', credentials: ['refreshToken'] });
      expect(catalog.find(item => item.id === 'bark')?.connect).toBeUndefined();
    } finally { f.clean(); }
  });

  test('disconnects a builtin connector without deleting it', async () => {
    const f = fixture(); try {
      f.registry.register({ id: 'outlook-home', name: 'Outlook', description: '', transport: 'builtin', provider: 'outlook', settings: {}, credentials: { accessToken: 'access', refreshToken: 'refresh', expiresAt: '2099-01-01T00:00:00.000Z' }, tools: [] });
      await f.registry.disconnect('outlook-home');
      expect(f.registry.get('outlook-home').credentials).toEqual({});
      expect(f.registry.listPublic()[0]!.credentialsSet).toEqual([]);
    } finally { f.clean(); }
  });
});

describe('bark provider', () => {
  test('parses Bark URLs and bare device keys', () => {
    expect(parseBarkUrl('https://api.day.app/key')).toEqual({ serverUrl: 'https://api.day.app', deviceKey: 'key' });
    expect(parseBarkUrl('https://bark.example.com/key/title/body')).toEqual({ serverUrl: 'https://bark.example.com', deviceKey: 'key' });
    expect(parseBarkUrl('key')).toEqual({ serverUrl: 'https://api.day.app', deviceKey: 'key' });
    expect(() => parseBarkUrl('https://api.day.app')).toThrow('device key');
  });

  test('posts the device key and notification fields', async () => {
    const original = globalThis.fetch;
    let body: any = null;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => { body = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ code: 200, message: 'success' }), { status: 200 }); }) as typeof fetch;
    try {
      const result = await barkProvider.call('send', { title: 'Hi', body: 'There' }, { connectorId: 'bark', settings: {}, credentials: { pushUrl: 'https://api.day.app/my-key' } }, {});
      expect(result).toMatchObject({ ok: true });
      expect(body).toMatchObject({ device_key: 'my-key', title: 'Hi', body: 'There' });
    } finally { globalThis.fetch = original; }
  });
});

describe('weather provider', () => {
  test('geocodes and returns current weather without an API key', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request) => {
      const target = String(url);
      if (target.includes('geocoding-api')) return new Response(JSON.stringify({ results: [{ name: '杭州', latitude: 30.2, longitude: 120.1, country: '中国', timezone: 'Asia/Shanghai' }] }), { status: 200 });
      return new Response(JSON.stringify({ current: { time: '2026-11-18T10:00', temperature_2m: 18, relative_humidity_2m: 60, apparent_temperature: 17, precipitation: 0, weather_code: 1, wind_speed_10m: 3, wind_direction_10m: 90, is_day: 1 } }), { status: 200 });
    }) as typeof fetch;
    try {
      const result: any = await weatherProvider.call('weather', { kind: 'current' }, { connectorId: 'weather', settings: { city: '杭州' }, credentials: {} }, {});
      expect(result.location.name).toBe('杭州');
      expect(result.current.condition).toBe('大部晴朗');
      expect(result.current.temperature).toBe(18);
    } finally { globalThis.fetch = original; }
  });
});

describe('calendar provider configuration', () => {
  test('normalizes iCloud and custom CalDAV settings', () => {
    const icloud = caldavProvider.normalize({ preset: 'icloud', username: 'me@example.com' }, { password: 'app-pass' });
    expect(icloud.settings).toMatchObject({ preset: 'icloud', serverUrl: 'https://caldav.icloud.com', username: 'me@example.com' });
    expect(icloud.credentials).toEqual({ password: 'app-pass' });
    const custom = caldavProvider.normalize({ preset: 'custom', serverUrl: 'https://dav.example.com/', username: 'user' }, { password: 'pass' });
    expect(custom.settings.serverUrl).toBe('https://dav.example.com');
    expect(() => caldavProvider.normalize({ preset: 'custom', serverUrl: 'ftp://x', username: 'u' }, { password: 'p' })).toThrow('HTTP');
  });

  test('uses the built-in Microsoft app when no client ID is configured', async () => {
    const originalFetch = globalThis.fetch;
    const previous = process.env.DUDU_MICROSOFT_CLIENT_ID;
    delete process.env.DUDU_MICROSOFT_CLIENT_ID;
    let body = '';
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      body = String(init?.body);
      return new Response(JSON.stringify({ device_code: 'd', user_code: 'U', verification_uri: 'https://microsoft.com/devicelogin', expires_in: 900, interval: 5, message: 'go' }), { status: 200 });
    }) as typeof fetch;
    try {
      await startOutlookDevice();
      expect(body).toContain(`client_id=${DEFAULT_MICROSOFT_CLIENT_ID}`);
    } finally {
      globalThis.fetch = originalFetch;
      if (previous === undefined) delete process.env.DUDU_MICROSOFT_CLIENT_ID;
      else process.env.DUDU_MICROSOFT_CLIENT_ID = previous;
    }
  });

  test('starts the Microsoft device flow with the configured public client', async () => {
    const original = globalThis.fetch;
    const previous = process.env.DUDU_MICROSOFT_CLIENT_ID;
    process.env.DUDU_MICROSOFT_CLIENT_ID = 'client-123';
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => { expect(String(init?.body)).toContain('client_id=client-123'); return new Response(JSON.stringify({ device_code: 'd', user_code: 'U', verification_uri: 'https://microsoft.com/devicelogin', expires_in: 900, interval: 5, message: 'go' }), { status: 200 }); }) as typeof fetch;
    try {
      const result = await startOutlookDevice();
      expect(result).toMatchObject({ deviceCode: 'd', userCode: 'U', interval: 5 });
      expect(outlookProvider.normalize({}, {})).toEqual({ settings: {}, credentials: {} });
    } finally {
      globalThis.fetch = original;
      if (previous === undefined) delete process.env.DUDU_MICROSOFT_CLIENT_ID; else process.env.DUDU_MICROSOFT_CLIENT_ID = previous;
    }
  });
});

describe('calendar ICS helpers', () => {
  test('builds and parses a timed event', () => {
    const raw = buildEventIcs({ summary: '评审', start: '2026-11-18T09:00:00Z', end: '2026-11-18T10:00:00Z', location: '会议室', description: '说明' }, 'uid-1');
    const events = parseCalendarEvents(raw, new Date('2026-11-18T00:00:00Z'), new Date('2026-11-19T00:00:00Z'));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ summary: '评审', location: '会议室', start: '2026-11-18T09:00:00.000Z' });
  });

  test('expands recurring events and patches fields without dropping alarms', () => {
    const raw = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:r1\r\nDTSTAMP:20261118T000000Z\r\nDTSTART:20261118T090000Z\r\nDTEND:20261118T100000Z\r\nRRULE:FREQ=DAILY;COUNT=3\r\nSUMMARY:Standup\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT10M\r\nEND:VALARM\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
    const events = parseCalendarEvents(raw, new Date('2026-11-18T00:00:00Z'), new Date('2026-11-22T00:00:00Z'));
    expect(events).toHaveLength(3);
    const patched = patchEventIcs(raw, { summary: 'Daily standup', location: 'Room A' });
    expect(patched).toContain('SUMMARY:Daily standup');
    expect(patched).toContain('LOCATION:Room A');
    expect(patched).toContain('BEGIN:VALARM');
    expect(patched.match(/SUMMARY:/g)?.length).toBe(1);
  });
});

describe('weixin protocol', () => {
  test('sends text with the official message envelope and preserves the context token', async () => {
    const original = globalThis.fetch;
    let body: any = null;
    let headers: any = null;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)); headers = init?.headers;
      return new Response(JSON.stringify({ ret: 0, message_id: 'm1' }), { status: 200 });
    }) as typeof fetch;
    try {
      const result = await sendWeixinText('https://ilinkai.weixin.qq.com', 'token', 'peer-1', 'hello', 'ctx-1');
      expect(result.messageId).toBe('m1');
      expect(body.msg).toMatchObject({ to_user_id: 'peer-1', message_type: 2, message_state: 2, context_token: 'ctx-1' });
      expect(body.msg.item_list[0]).toEqual({ type: 1, text_item: { text: 'hello' } });
      expect(headers.authorization).toBe('Bearer token');
      expect(headers['iLink-App-Id']).toBe('bot');
    } finally { globalThis.fetch = original; }
  });
});

describe('weixin service', () => {
  test('mirrors an inbound message, exposes externalReply, and records a reply in the timeline', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dudu-weixin-service-'));
    const store = new Store(join(root, 'state.sqlite'));
    let service: WeixinService | undefined;
    const registry = new ConnectorRegistry(root, createBuiltinProviders({ weixin: () => service }));
    service = new WeixinService(registry, store, root);
    const original = globalThis.fetch;
    let sent = false;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      if (target.includes('getupdates')) {
        if (!sent) {
          sent = true;
          return new Response(JSON.stringify({ ret: 0, get_updates_buf: 'buf-1', msgs: [{ message_id: 'm-1', from_user_id: 'peer-1', message_type: 1, context_token: 'ctx-1', item_list: [{ type: 1, text_item: { text: '你好' } }] }] }), { status: 200 });
        }
        return new Promise<Response>((_resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }); });
      }
      if (target.includes('sendmessage')) return new Response(JSON.stringify({ ret: 0, message_id: 'srv-1' }), { status: 200 });
      throw new Error(`unexpected fetch: ${target}`);
    }) as typeof fetch;
    try {
      registry.register({ id: 'weixin-home', name: 'WeChat', description: '', transport: 'builtin', provider: 'weixin', settings: { botId: 'bot-a', enabled: true }, credentials: { token: 'tok', baseUrl: 'https://ilinkai.weixin.qq.com' }, tools: [] });
      service.start();
      for (let index = 0; index < 50 && !store.pending('bot-a').length; index++) await new Promise(resolve => setTimeout(resolve, 10));
      const events = store.pending('bot-a');
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe('message.weixin');
      expect(events[0]!.payload).toMatchObject({
        text: '你好',
        peer: 'peer-1',
        externalReply: { tool: 'weixin-home__send_text', arguments: { to: 'peer-1' } },
      });
      expect(store.messages().some(message => message.botId === 'bot-a' && message.sender === 'user' && message.text === '你好')).toBe(true);
      await service.sendText('weixin-home', '收到');
      expect(store.messages().some(message => message.botId === 'bot-a' && message.sender === 'bot-a' && message.text === '收到')).toBe(true);
    } finally {
      await service.stop();
      globalThis.fetch = original;
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('connector HTTP routes', () => {
  test('creates a builtin instance, masks credentials in state, and deletes it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dudu-builtin-http-'));
    const app = createApp(root, undefined, { autoStart: false });
    try {
      app.config.saveBot({ id: 'a', name: 'A' });
      const create = await app.fetch(new Request('http://localhost/api/connectors', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'bark-home', name: 'Bark home', description: 'home', transport: 'builtin', provider: 'bark', settings: {}, credentials: { pushUrl: 'https://api.day.app/secret-key' }, tools: [] }) }));
      expect(create.status).toBe(201);
      const state = await app.fetch(new Request('http://localhost/api/state'));
      const text = await state.text();
      expect(text).toContain('bark-home');
      expect(text).toContain('credentialsSet');
      expect(text).not.toContain('secret-key');
      const removed = await app.fetch(new Request('http://localhost/api/connectors/bark-home', { method: 'DELETE' }));
      expect(removed.status).toBe(200);
      const after = await app.fetch(new Request('http://localhost/api/state'));
      expect(await after.text()).not.toContain('bark-home');
    } finally { await app.close(); rmSync(root, { recursive: true, force: true }); }
  });

  test('starts and polls Outlook device sign-in without saving a connector', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dudu-outlook-draft-'));
    const app = createApp(root, undefined, { autoStart: false });
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      if (target.includes('/devicecode')) {
        expect(String(init?.body)).toContain('client_id=client-abc');
        return new Response(JSON.stringify({ device_code: 'device', user_code: 'USER', verification_uri: 'https://microsoft.com/devicelogin', expires_in: 900, interval: 5, message: 'go' }), { status: 200 });
      }
      return new Response(JSON.stringify({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 }), { status: 200 });
    }) as typeof fetch;
    try {
      const start = await app.fetch(new Request('http://localhost/api/outlook/device/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings: { clientId: 'client-abc' } }) }));
      expect(start.status).toBe(200);
      expect((await start.json() as { userCode: string }).userCode).toBe('USER');
      const poll = await app.fetch(new Request('http://localhost/api/outlook/device/poll', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceCode: 'device', settings: { clientId: 'client-abc' } }) }));
      expect(poll.status).toBe(200);
      expect(await poll.json()).toMatchObject({ status: 'connected', credentials: { refreshToken: 'refresh' } });
      const state = await app.fetch(new Request('http://localhost/api/state'));
      expect((await state.json() as { connectors: unknown[] }).connectors).toHaveLength(0);
    } finally {
      globalThis.fetch = original;
      await app.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('disconnect clears sign-in credentials without deleting the connector', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dudu-connector-disconnect-'));
    const app = createApp(root, undefined, { autoStart: false });
    try {
      const create = await app.fetch(new Request('http://localhost/api/connectors', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'outlook-home', name: 'Outlook', description: '', transport: 'builtin', provider: 'outlook', settings: {}, credentials: { accessToken: 'access', refreshToken: 'refresh' }, tools: [] }) }));
      expect(create.status).toBe(201);
      const disconnect = await app.fetch(new Request('http://localhost/api/connectors/outlook-home/disconnect', { method: 'POST' }));
      expect(disconnect.status).toBe(200);
      const state = await app.fetch(new Request('http://localhost/api/state'));
      const connector = (await state.json() as { connectors: Array<{ id: string; credentialsSet?: string[] }> }).connectors.find(item => item.id === 'outlook-home');
      expect(connector?.credentialsSet).toEqual([]);
      expect(existsSync(join(root, 'connectors', 'outlook-home', 'connector.json'))).toBe(true);
    } finally { await app.close(); rmSync(root, { recursive: true, force: true }); }
  });
});

describe('server-generated connector IDs', () => {
  test('creates distinct opaque IDs when the client sends none', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dudu-connector-ids-'));
    const app = createApp(root, undefined, { autoStart: false });
    try {
      const create = () => app.fetch(new Request('http://localhost/api/connectors', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Bark', description: 'home', transport: 'builtin', provider: 'bark', settings: {}, credentials: { pushUrl: 'https://api.day.app/key' }, tools: [] }) }));
      const first = await create();
      const second = await create();
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      const firstBody = await first.json() as { id: string };
      const secondBody = await second.json() as { id: string };
      expect(firstBody.id).not.toBe(secondBody.id);
      expect(firstBody.id).toMatch(/^bark-[0-9a-f]{8}$/);
      const state = await app.fetch(new Request('http://localhost/api/state'));
      expect((await state.json() as { connectors: unknown[] }).connectors).toHaveLength(2);
    } finally { await app.close(); rmSync(root, { recursive: true, force: true }); }
  });
});

describe('skills store', () => {
  test('loads workspace skills through the same resource loader used by agents', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dudu-skills-loader-'));
    try {
      const store = new SkillStore(root);
      mkdirSync(join(store.root, 'demo'), { recursive: true });
      writeFileSync(join(store.root, 'demo', 'SKILL.md'), '---\nname: demo\ndescription: Demo skill\n---\n\nUse this.\n');
      const loader = new DefaultResourceLoader({ cwd: root, agentDir: join(root, '.pi'), settingsManager: SettingsManager.inMemory({}), noSkills: true, additionalSkillPaths: [store.root] });
      await loader.reload();
      expect(loader.getSkills().skills.map(skill => skill.name)).toContain('demo');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('lists and removes workspace skills', () => {
    const root = mkdtempSync(join(tmpdir(), 'dudu-skills-'));
    try {
      const store = new SkillStore(root);
      mkdirSync(join(store.root, 'demo'), { recursive: true });
      writeFileSync(join(store.root, 'demo', 'SKILL.md'), '---\nname: demo\ndescription: Demo skill\n---\n\nUse this.\n');
      expect(store.list()).toHaveLength(1);
      expect(store.list()[0]).toMatchObject({ slug: 'demo', name: 'demo', description: 'Demo skill' });
      store.remove('demo');
      expect(store.list()).toHaveLength(0);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('rejects a repository skill that contains a symlink', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request) => {
      const target = String(url);
      if (target.includes('/repos/owner/repo') && !target.includes('/git/')) return new Response(JSON.stringify({ default_branch: 'main' }), { status: 200 });
      if (target.includes('/git/trees/')) return new Response(JSON.stringify({ tree: [{ path: 'skills/demo/SKILL.md', type: 'blob', mode: '100644', size: 40 }, { path: 'skills/demo/link', type: 'blob', mode: '120000', size: 4 }] }), { status: 200 });
      if (target.includes('raw.githubusercontent.com') && target.endsWith('/SKILL.md')) return new Response('---\nname: demo\ndescription: Demo\n---\n', { status: 200 });
      return new Response('x', { status: 200 });
    }) as typeof fetch;
    const root = mkdtempSync(join(tmpdir(), 'dudu-skills-symlink-'));
    try {
      const store = new SkillStore(root);
      await expect(store.install('owner/repo', 'skills/demo')).rejects.toThrow('symlink');
    } finally { globalThis.fetch = original; rmSync(root, { recursive: true, force: true }); }
  });

  test('tests an unsaved builtin draft without persisting it', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request) => {
      if (String(url).includes('geocoding-api')) return new Response(JSON.stringify({ results: [{ name: '杭州', latitude: 30.2, longitude: 120.1 }] }), { status: 200 });
      return new Response(JSON.stringify({ current: { temperature_2m: 12, relative_humidity_2m: 50, apparent_temperature: 11, precipitation: 0, weather_code: 0, wind_speed_10m: 2, wind_direction_10m: 90, is_day: 1 } }), { status: 200 });
    }) as typeof fetch;
    const f = fixture();
    try {
      const result: any = await f.registry.testDraft({ provider: 'weather', settings: { city: '杭州' }, credentials: {} });
      expect(result.location.name).toBe('杭州');
      expect(f.registry.list()).toHaveLength(0);
    } finally { globalThis.fetch = original; f.clean(); }
  });

  test('builds a popular list by merging broad searches and sorting by installs', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request) => {
      const query = new URL(String(url)).searchParams.get('q');
      return new Response(JSON.stringify({ skills: [
        { id: `${query}/a`, source: `${query}/repo`, skillId: 'a', name: `${query}-a`, installs: query === 'ai' ? 100 : 10 },
        { id: 'shared', source: 'shared/repo', skillId: 'shared', name: 'shared', installs: 50 },
      ] }), { status: 200 });
    }) as typeof fetch;
    const root = mkdtempSync(join(tmpdir(), 'dudu-skills-popular-'));
    try {
      const store = new SkillStore(root);
      const list = await store.popular();
      expect(list[0]!.id).toBe('ai/a');
      expect(list.filter(skill => skill.id === 'shared')).toHaveLength(1);
      expect(list).toHaveLength(6);
    } finally { globalThis.fetch = original; rmSync(root, { recursive: true, force: true }); }
  });

  test('searches the public skills.sh endpoint', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ skills: [{ id: 'anthropics/skills/pdf', source: 'anthropics/skills', skillId: 'pdf', name: 'pdf', installs: 10 }] }), { status: 200 })) as unknown as typeof fetch;
    const root = mkdtempSync(join(tmpdir(), 'dudu-skills-search-'));
    try {
      const store = new SkillStore(root);
      expect(await store.search('pdf')).toEqual([{ id: 'anthropics/skills/pdf', source: 'anthropics/skills', skillId: 'pdf', name: 'pdf', installs: 10 }]);
    } finally { globalThis.fetch = original; rmSync(root, { recursive: true, force: true }); }
  });
});
