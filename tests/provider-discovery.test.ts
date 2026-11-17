import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server';

test('model discovery uses provider protocol and supports errors, empty lists and cancellation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dudu-discovery-'));
  const requests: { path: string; authorization: string | null; key: string | null; version: string | null }[] = [];
  let aborted = false;
  const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
    const path = new URL(req.url).pathname;
    requests.push({ path, authorization: req.headers.get('authorization'), key: req.headers.get('x-api-key'), version: req.headers.get('anthropic-version') });
    if (path.startsWith('/error')) return new Response('Unavailable', { status: 503 });
    if (path.startsWith('/empty')) return Response.json({ data: [] });
    if (path.startsWith('/slow')) {
      await new Promise<void>(resolve => { req.signal.addEventListener('abort', () => { aborted = true; resolve(); }, { once: true }); });
      return Response.json({ data: [] });
    }
    return path.startsWith('/anthropic') ? Response.json({ models: ['deepseek-flash', { id: 'other', display_name: 'Other' }] }) : Response.json({ data: [{ id: 'deepseek-flash' }] });
  } });
  const app = createApp(root, async () => { throw new Error('No model configured'); });
  const discover = (base: string, api = 'openai-completions', signal?: AbortSignal) => app.fetch(new Request('http://localhost/api/providers/models', {
    method: 'POST', body: JSON.stringify({ api, baseUrl: `${upstream.url.origin}${base}`, apiKey: ' test-key ' }), signal,
  }));
  try {
    expect(await (await discover('/v1/')).json()).toEqual({ models: [{ id: 'deepseek-flash', name: 'deepseek-flash' }] });
    expect(requests.at(-1)).toMatchObject({ path: '/v1/models', authorization: 'Bearer test-key', key: null });
    expect(await (await discover('/anthropic', 'anthropic-messages')).json()).toEqual({ models: [{ id: 'deepseek-flash', name: 'deepseek-flash' }, { id: 'other', name: 'Other' }] });
    expect(requests.at(-1)).toMatchObject({ path: '/anthropic/v1/models', key: 'test-key', version: '2023-06-01', authorization: null });
    expect(await (await discover('/empty')).json()).toEqual({ models: [] });
    expect((await discover('/error')).status).toBe(400);
    const controller = new AbortController();
    const pending = discover('/slow', 'openai-responses', controller.signal);
    const deadline = Date.now() + 1000;
    while (!requests.some(request => request.path.startsWith('/slow')) && Date.now() < deadline) await Bun.sleep(5);
    controller.abort();
    expect((await pending).status).toBe(400);
    const abortDeadline = Date.now() + 1000;
    while (!aborted && Date.now() < abortDeadline) await Bun.sleep(5);
    expect(aborted).toBe(true);
    expect(app.config.global().providers).toEqual([]);
    const completed = await app.fetch(new Request('http://localhost/api/setup', { method: 'PUT', body: JSON.stringify({ completed: true }) }));
    expect(completed.status).toBe(200);
    expect(app.config.global().setupCompleted).toBe(true);
    expect(app.config.global().defaultModel).toBeUndefined();
  } finally {
    upstream.stop(true);
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});
