import { test, expect } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server';
import type { SessionPort } from '../src/agent/scheduler';

const session: SessionPort = {
  prompt: async () => {}, steer: async () => {}, followUp: async () => {}, abort: async () => {},
  clearQueue: () => {}, dispose: () => {}, subscribe: () => () => {},
};

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dudu-workspace-'));
  const app = createApp(root, async () => session);
  app.config.saveBot({ id: 'a', name: 'A' });
  const call = (path: string, init?: RequestInit) => app.fetch(new Request(`http://localhost${path}`, init));
  return { root, app, call };
}

async function enable(call: (path: string, init?: RequestInit) => Promise<Response>, advancedMode: boolean) {
  return call('/api/advanced-settings', { method: 'PUT', body: JSON.stringify({ advancedMode }) });
}

test('advanced mode gates workspace files while composer uploads stay available', async () => {
  const { root, app, call } = fixture();
  try {
    expect((await call('/api/bots/a/files?path=')).status).toBe(403);
    expect((await call('/api/advanced-settings', { method: 'PUT', body: JSON.stringify({ advancedMode: 'yes' }) })).status).toBe(400);
    expect((await enable(call, true)).status).toBe(200);
    expect(((await (await call('/api/state')).json()) as { advancedMode: boolean }).advancedMode).toBe(true);

    const listing = await (await call('/api/bots/a/files?path=')).json() as { entries: { name: string; type: string }[] };
    expect(listing.entries.map(entry => entry.name)).toEqual(expect.arrayContaining(['work', 'artifacts', 'BOTS.md', 'MEMORY.md']));
    expect(listing.entries.every(entry => entry.type === 'dir' || entry.type === 'file')).toBe(true);

    const form = new FormData();
    form.append('files', new File(['hello'], 'note.txt', { type: 'text/plain' }));
    const upload = await call('/api/bots/a/files?path=work', { method: 'POST', body: form });
    expect(upload.status).toBe(201);
    const uploaded = await upload.json() as { files: { path: string; mime: string }[] };
    expect(uploaded.files[0]).toMatchObject({ path: 'work/note.txt', mime: 'text/plain' });

    const work = await (await call('/api/bots/a/files?path=work')).json() as { entries: { name: string; mime: string }[] };
    expect(work.entries.find(entry => entry.name === 'note.txt')?.mime).toBe('text/plain');
    writeFileSync(join(app.config.botPath('a'), 'work', '.gitignore'), 'node_modules\n');
    writeFileSync(join(app.config.botPath('a'), 'work', '.env'), 'TOKEN=x\n');
    mkdirSync(join(app.config.botPath('a'), 'work', '.git'));
    const hidden = await (await call('/api/bots/a/files?path=work')).json() as { entries: { name: string }[] };
    expect(hidden.entries.map(entry => entry.name)).toEqual(expect.arrayContaining(['.gitignore', '.env']));
    expect(hidden.entries.some(entry => entry.name === '.git')).toBe(false);
    expect(await (await call('/api/bots/a/file?path=work/note.txt')).text()).toBe('hello');

    expect((await call('/api/bots/a/file?path=../bot.json')).status).toBe(400);
    expect((await call('/api/bots/a/file?path=/etc/passwd')).status).toBe(400);
    expect((await call('/api/bots/a/files?path=.pi')).status).toBe(400);
    symlinkSync('/etc/passwd', join(app.config.botPath('a'), 'work', 'link'));
    expect((await call('/api/bots/a/file?path=work/link')).status).toBe(400);
    expect((await (await call('/api/bots/a/files?path=work')).json() as { entries: { name: string; type: string }[] }).entries.find(entry => entry.name === 'link')?.type).toBe('symlink');

    expect((await call('/api/bots/a/files/mkdir', { method: 'POST', body: JSON.stringify({ path: 'work/docs' }) })).status).toBe(201);
    expect((await (await call('/api/bots/a/files?path=work')).json() as { entries: { name: string }[] }).entries.some(entry => entry.name === 'docs')).toBe(true);
    expect((await call('/api/bots/a/files?path=work/docs&recursive=1', { method: 'DELETE' })).status).toBe(200);
    expect((await call('/api/bots/a/files?path=work', { method: 'DELETE' })).status).toBe(400);
    expect((await call('/api/bots/a/files?path=work/note.txt', { method: 'DELETE' })).status).toBe(200);
    expect(existsSync(join(app.config.botPath('a'), 'work', 'note.txt'))).toBe(false);

    const composer = new FormData();
    composer.append('files', new File(['uploaded'], 'upload.txt', { type: 'text/plain' }));
    const composerUpload = await call('/api/bots/a/uploads', { method: 'POST', body: composer });
    expect(composerUpload.status).toBe(201);
    const composerResult = await composerUpload.json() as { files: { path: string; workPath: string }[] };
    expect(composerResult.files[0]).toMatchObject({ path: 'work/uploads/upload.txt', workPath: 'uploads/upload.txt' });

    const cursor = app.store.latestSeq();
    const message = await call('/api/messages', { method: 'POST', body: JSON.stringify({ botId: 'a', text: '', attachments: [{ path: 'uploads/upload.txt', name: 'upload.txt' }] }) });
    expect(message.status).toBe(202);
    const stored = app.store.messages().find(entry => entry.sender === 'user');
    expect(stored?.attachments?.[0]).toMatchObject({ name: 'upload.txt', mime: 'text/plain', size: 8 });
    const event = app.store.replay(cursor).find(entry => entry.type === 'message.web');
    expect(event?.payload).toMatchObject({ text: '', attachments: [{ name: 'upload.txt', path: 'uploads/upload.txt', mime: 'text/plain' }] });
    expect(event?.priority).toBe('high');
    expect((await call('/api/messages', { method: 'POST', body: JSON.stringify({ botId: 'a', text: '' }) })).status).toBe(400);
    expect((await call('/api/messages', { method: 'POST', body: JSON.stringify({ botId: 'a', text: 'x', attachments: [{ path: '../bot.json' }] }) })).status).toBe(400);

    expect((await enable(call, false)).status).toBe(200);
    expect((await call('/api/bots/a/files?path=')).status).toBe(403);
    const after = new FormData();
    after.append('files', new File(['ok'], 'again.txt', { type: 'text/plain' }));
    expect((await call('/api/bots/a/uploads', { method: 'POST', body: after })).status).toBe(201);
  } finally {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});
