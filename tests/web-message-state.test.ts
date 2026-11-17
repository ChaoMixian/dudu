import { expect, test } from 'bun:test';
import { mergeMessagePage, mergeMessageState } from '../src/web/lib/message-state';
import { EMPTY_STATE, type AppState, type Message } from '../src/web/lib/types';
import type { BotConfig } from '../src/contracts';

const bot = (id: string): BotConfig => ({ id, name: id, description: '', paused: false, computer: {} });
const message = (id: string, botId: string, seq: number, kind: Message['kind'] = 'message'): Message => ({
  id, botId, conversationId: 'default', sender: 'user', text: id, kind, status: 'sent', createdAt: '', seq,
});

test('incremental state merge keeps loaded history and replaces reactions', () => {
  const current: AppState = {
    ...EMPTY_STATE,
    bots: [bot('a'), bot('b')],
    messages: [message('old', 'a', 1), message('gone', 'b', 2), message('old-reaction', 'a', 3, 'reaction')],
    messageReferences: [message('ref-a', 'a', 0), message('ref-b', 'b', 0)],
    messageCursors: { a: 10, b: 20 },
  };
  const next: AppState = {
    ...EMPTY_STATE,
    bots: [bot('a')],
    messages: [message('new', 'a', 4), message('new-reaction', 'a', 5, 'reaction')],
    messageReferences: [message('ref-a2', 'a', 0)],
    messageCursors: { a: 30 },
  };
  const merged = mergeMessageState(current, next);
  expect(merged.messages.map(item => item.id)).toEqual(['old', 'new', 'new-reaction']);
  expect(merged.messageReferences?.map(item => item.id)).toEqual(['ref-a', 'ref-a2']);
  expect(merged.messageCursors).toEqual({ a: 30 });
});

test('older page merge keeps existing messages and reactions', () => {
  const current: AppState = {
    ...EMPTY_STATE,
    bots: [bot('a')],
    messages: [message('new', 'a', 5), message('reaction', 'a', 6, 'reaction')],
    messageReferences: [message('ref-old', 'a', 0)],
    messageCursors: { a: 5 },
  };
  const page = {
    messages: [message('older', 'a', 2)],
    references: [message('ref-page', 'a', 0)],
    cursor: 2,
  };
  const merged = mergeMessagePage(current, 'a', page);
  expect(merged.messages.map(item => item.id)).toEqual(['older', 'new', 'reaction']);
  expect(merged.messageReferences?.map(item => item.id)).toEqual(['ref-old', 'ref-page']);
  expect(merged.messageCursors).toEqual({ a: 2 });
});
