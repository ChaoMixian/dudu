import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { computerAction, computerShot, computerStatus, computerWatch } from '../src/web/lib/computers';

// All HTTP is mocked: these tests never start a desktop or invoke a model.
let fetchMock: ReturnType<typeof spyOn> | undefined;
afterEach(() => { fetchMock?.mockRestore(); fetchMock = undefined; });

function mockResponse(response: Response) {
  fetchMock = spyOn(globalThis, 'fetch').mockResolvedValue(response);
  return fetchMock;
}

describe('computer UI requests', () => {
  for (const action of ['start', 'stop', 'takeover'] as const) {
    test(`${action} sends an explicit JSON object and forwards cancellation`, async () => {
      const fetch = mockResponse(Response.json({ status: 'requested' }));
      const controller = new AbortController();
      await computerAction('secret', 'bot a', action, controller.signal);
      expect(fetch).toHaveBeenCalledTimes(1);
      const [url, init] = fetch.mock.calls[0]!;
      expect(url).toBe(`/api/bots/bot%20a/computer/${action}`);
      expect(init.method).toBe('POST');
      expect(init.body).toBe('{}');
      expect(init.headers.get('Content-Type')).toBe('application/json');
      expect(init.headers.get('Authorization')).toBe('Bearer secret');
      expect(init.signal).toBe(controller.signal);
    });
  }

  test('status reads the real desktop rather than the cached application state', async () => {
    const status = { id: 'desktop', botId: 'bot', state: 'ready' as const, width: 1280, height: 800 };
    const fetch = mockResponse(Response.json(status));
    const controller = new AbortController();
    expect(await computerStatus('', 'bot', controller.signal)).toEqual(status);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('/api/bots/bot/computer/status');
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect(init.signal).toBe(controller.signal);
  });

  test('watch POST also has an explicit JSON body', async () => {
    const fetch = mockResponse(Response.json({ url: 'http://127.0.0.1:4000' }));
    expect(await computerWatch('', 'bot')).toEqual({ url: 'http://127.0.0.1:4000' });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('/api/bots/bot/computer/watch');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{}');
    expect(init.headers.get('Content-Type')).toBe('application/json');
  });

  test('screenshot requests binary data and forwards the abort signal', async () => {
    const fetch = mockResponse(new Response('fake png', { headers: { 'Content-Type': 'image/png' } }));
    const controller = new AbortController();
    const blob = await computerShot('token', 'bot', controller.signal);
    expect(blob.type).toBe('image/png');
    expect(await blob.text()).toBe('fake png');
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('/api/bots/bot/computer/shot');
    expect(init.headers.get('Authorization')).toBe('Bearer token');
    expect(init.signal).toBe(controller.signal);
  });

  test('request failures remain available for visible UI errors', async () => {
    mockResponse(new Response('desktop unavailable', { status: 503 }));
    await expect(computerAction('', 'bot', 'stop')).rejects.toThrow('desktop unavailable');
  });

  test('already aborted status reads reject without a usable stale result', async () => {
    const controller = new AbortController();
    controller.abort();
    const abortingFetch = Object.assign(async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      init?.signal?.throwIfAborted();
      throw new Error('Unexpected request without an aborted signal');
    }, { preconnect: globalThis.fetch.preconnect });
    fetchMock = spyOn(globalThis, 'fetch').mockImplementation(abortingFetch);
    await expect(computerStatus('', 'bot', controller.signal)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
