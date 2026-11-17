import { expect, test } from 'bun:test';
import { Store } from '../src/core/store';
import { createApp } from '../src/server';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('message pages are bounded, ordered, isolated, and carry reply references', () => {
  const store = new Store(':memory:');
  try {
    const messages = Array.from({ length: 121 }, (_, i) => store.message('a', 'default', i % 2 ? 'user' : 'a', `message ${i}`));
    store.message('b', 'default', 'b', 'other bot');
    store.message('a', 'private', 'a', 'other conversation');
    const reply = store.message('a', 'default', 'a', 'reply', 'sent', undefined, 'message', undefined, undefined, messages[0]!.id);
    const reaction = store.message('a', 'default', 'user', '', 'sent', undefined, 'reaction', messages[120]!.id, '👍');
    const latest = store.messagePage('a');
    expect(latest.messages).toHaveLength(50);
    expect(latest.messages.some(message => message.kind === 'reaction')).toBe(false);
    expect(latest.references.map(message => message.id)).toContain(messages[0]!.id);
    expect(latest.messages.every(message => message.botId === 'a' && message.conversationId === 'default')).toBe(true);
    expect(store.reactionsForBots(['a']).map(message => message.id)).toContain(reaction.id);
    const older = store.messagePage('a', latest.cursor!);
    const oldest = store.messagePage('a', older.cursor!);
    expect(oldest.cursor).toBeNull();
    const combined = [...oldest.messages, ...older.messages, ...latest.messages];
    expect(combined.map(message => message.id)).toEqual([...messages, reply].map(message => message.id));
    const after = store.messagesAfter('a', latest.messages.at(-1)!.seq);
    expect(after.messages).toEqual([]);
    const newer = store.message('a', 'default', 'a', 'newer');
    expect(store.messagesAfter('a', latest.messages.at(-1)!.seq).messages.map(message => message.id)).toEqual([newer.id]);
    store.toggleReaction('a', 'default', messages[120]!.id, '👍', 'user');
    expect(store.reactionsForBots(['a']).some(message => message.id === reaction.id)).toBe(false);
    expect(store.messageById(reply.id)?.replyTo).toBe(messages[0]!.id);
    expect(store.searchMessages('message 0').map(message => message.id)).toEqual([messages[0]!.id]);
    expect(store.messagePage('empty')).toEqual({ messages: [], references: [], cursor: null });
  } finally { store.close(); }
});

test('HTTP snapshots use per-bot cursors and incremental messageAfter sync', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dudu-message-pages-'));
  const app = createApp(root);
  try {
    app.config.saveBot({ id: 'a', name: 'A' });
    const messages = Array.from({ length: 105 }, (_, i) => app.store.message('a', 'default', 'a', `entry ${i}`));
    const get = async (path: string) => (await app.fetch(new Request(`http://localhost${path}`))).json() as Promise<any>;
    const snapshot = await get('/api/state');
    const initial = snapshot.messages.filter((message: any) => message.kind !== 'reaction');
    expect(initial).toHaveLength(50);
    const page = await get(`/api/bots/a/messages?before=${snapshot.messageCursors.a}`);
    expect(page.messages).toHaveLength(50);
    expect(page.messages.at(-1).seq).toBeLessThan(initial[0].seq);
    const newest = initial.at(-1).seq;
    const added = app.store.message('a', 'default', 'a', 'added');
    const synced = await get(`/api/state?messageAfter=${encodeURIComponent(JSON.stringify({ a: newest }))}`);
    expect(synced.messages.filter((message: any) => message.kind !== 'reaction').map((message: any) => message.id)).toEqual([added.id]);
    expect(synced.messageCursors.a).toBeUndefined();
    expect((await get('/api/messages/search?q=entry%200')).map((message: any) => message.id)).toEqual([messages[0]!.id]);
    expect((await app.fetch(new Request('http://localhost/api/bots/a/messages?before=bad'))).status).toBe(400);
    expect((await app.fetch(new Request(`http://localhost/api/state?messageAfter=${encodeURIComponent(JSON.stringify({ a: 'bad' }))}`))).status).toBe(400);
  } finally { await app.close(); rmSync(root, { recursive: true, force: true }); }
});
