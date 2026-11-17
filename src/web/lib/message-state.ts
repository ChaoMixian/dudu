import type { AppState, Message, MessagePage } from './types';

const dedupe = (messages: Message[]): Message[] => [...new Map(messages.map(message => [message.id, message])).values()];

/** Merge an incremental state response without dropping already loaded history. */
export function mergeMessageState(current: AppState, next: AppState): AppState {
  const botIds = new Set(next.bots.map(bot => bot.id));
  const timeline = [
    ...current.messages.filter(message => message.kind !== 'reaction' && botIds.has(message.botId)),
    ...next.messages.filter(message => message.kind !== 'reaction'),
  ];
  const reactions = next.messages.filter(message => message.kind === 'reaction');
  const messages = dedupe([...timeline, ...reactions]).sort((a, b) => a.seq - b.seq);
  const messageReferences = dedupe([...(current.messageReferences ?? []), ...(next.messageReferences ?? [])])
    .filter(message => botIds.has(message.botId));
  const messageCursors: Record<string, number | null> = { ...current.messageCursors, ...next.messageCursors };
  for (const botId of Object.keys(messageCursors)) if (!botIds.has(botId)) delete messageCursors[botId];
  return { ...current, ...next, messages, messageReferences, messageCursors };
}

/** Merge one older page for a single Bot. */
export function mergeMessagePage(current: AppState, botId: string, page: MessagePage): AppState {
  if (!current.bots.some(bot => bot.id === botId)) return current;
  return {
    ...current,
    messages: dedupe([...current.messages, ...page.messages]).sort((a, b) => a.seq - b.seq),
    messageReferences: dedupe([...(current.messageReferences ?? []), ...page.references]),
    messageCursors: { ...current.messageCursors, [botId]: page.cursor },
  };
}
