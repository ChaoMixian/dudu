import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { Spinner } from '@heroui/react';
import type { BotConfig } from '../../../contracts';
import { useAuth } from '../../auth/AuthContext';
import { useI18n } from '../../i18n';
import { errorText, pretty, sessionHistory, streamSession } from '../../lib/api';
import Icon from '../../ui/Icon';

type ToolCall = { id: string; name: string; args?: unknown };
type ToolState = { name: string; args?: unknown; status: 'running' | 'ok' | 'error'; result?: unknown; durationMs?: number };
type Item =
  | { kind: 'message'; id: string; role: string; text: string; thinking: string; toolCalls: ToolCall[]; usage?: unknown; timestamp?: unknown; live?: boolean }
  | { kind: 'toolResult'; id: string; toolCallId: string; name: string; text: string; isError: boolean; durationMs?: number }
  | { kind: 'note'; id: string; label: string; detail?: string };
type Data = { items: Item[]; tools: Record<string, ToolState>; liveId?: string };

function messageParts(message: any) {
  const text: string[] = [];
  const thinking: string[] = [];
  const toolCalls: ToolCall[] = [];
  const content = Array.isArray(message?.content) ? message.content
    : typeof message?.content === 'string' ? [message.content] : [];
  for (const block of content) {
    if (typeof block === 'string') { text.push(block); continue; }
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'text') text.push(String(block.text ?? ''));
    else if (block.type === 'thinking') thinking.push(String(block.thinking ?? block.text ?? ''));
    else if (block.type === 'toolCall') toolCalls.push({ id: String(block.id ?? ''), name: String(block.name ?? 'tool'), args: block.arguments });
  }
  return { text: text.join('\n\n'), thinking: thinking.join('\n\n'), toolCalls };
}

function resultText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  const content = (value as { content?: unknown }).content;
  if (Array.isArray(content)) return content.map(block => {
    if (typeof block === 'string') return block;
    if (block && typeof block === 'object' && (block as any).type === 'text') return String((block as any).text ?? '');
    if (block && typeof block === 'object' && (block as any).type === 'image') return `[image ${(block as any).mimeType ?? ''}]`;
    return pretty(block);
  }).join('\n');
  try { return pretty(value); } catch { return String(value); }
}

function historyData(entries: unknown[]): Data {  const items: Item[] = [];
  const tools: Record<string, ToolState> = {};
  const known = new Set<string>();
  entries.forEach((raw, index) => {
    const entry = raw as any;
    const id = String(entry?.id ?? `history-${index}`);
    if (entry?.type === 'message' && entry.message) {
      const message = entry.message;
      const role = String(message.role ?? 'assistant');
      if (role === 'toolResult') {
        const toolCallId = String(message.toolCallId ?? '');
        const name = String(message.toolName ?? 'tool');
        if (toolCallId) tools[toolCallId] = { name, status: message.isError ? 'error' : 'ok', result: message.content, durationMs: message.durationMs };
        if (!toolCallId || !known.has(toolCallId)) items.push({ kind: 'toolResult', id, toolCallId, name, text: resultText(message.content), isError: Boolean(message.isError), durationMs: message.durationMs });
        return;
      }
      const parts = messageParts(message);
      items.push({ kind: 'message', id, role, text: parts.text, thinking: parts.thinking, toolCalls: parts.toolCalls, usage: message.usage, timestamp: message.timestamp ?? entry.timestamp });
      for (const call of parts.toolCalls) known.add(call.id);
      return;
    }
    if (entry?.type === 'model_change') { items.push({ kind: 'note', id, label: 'model_change', detail: `${entry.provider ?? ''}/${entry.modelId ?? ''}` }); return; }
    if (entry?.type === 'thinking_level_change') { items.push({ kind: 'note', id, label: 'thinking_level_change', detail: String(entry.thinkingLevel ?? '') }); return; }
    items.push({ kind: 'note', id, label: String(entry?.type ?? 'event') });
  });
  return { items, tools };
}

/** Prepend an older page and drop standalone tool results once their call is visible. */
function mergeHistory(current: Data, older: Data): Data {
  const existing = new Set(current.items.map(item => item.id));
  const items = [...older.items.filter(item => !existing.has(item.id)), ...current.items];
  const calls = new Set<string>();
  for (const item of items) if (item.kind === 'message') for (const call of item.toolCalls) calls.add(call.id);
  return {
    ...current,
    items: items.filter(item => item.kind !== 'toolResult' || !calls.has(item.toolCallId)),
    tools: { ...older.tools, ...current.tools },
  };
}

function applyEvent(current: Data, event: any): Data {
  const type = String(event?.type ?? '');
  if (type === 'message_start' || type === 'message_update' || type === 'message_end') {
    const message = event.message;
    const role = String(message?.role ?? '');
    if (role === 'toolResult') {
      const toolCallId = String(message.toolCallId ?? '');
      if (!toolCallId) return current;
      const state: ToolState = { name: String(message.toolName ?? 'tool'), status: message.isError ? 'error' : 'ok', result: message.content, durationMs: message.durationMs };
      return { ...current, tools: { ...current.tools, [toolCallId]: { ...(current.tools[toolCallId] ?? {}), ...state } } };
    }
    const parts = messageParts(message);
    if (role === 'assistant') {
      const id = current.liveId ?? `live-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const live = type !== 'message_end';
      const item: Item = { kind: 'message', id, role, text: parts.text, thinking: parts.thinking, toolCalls: parts.toolCalls, usage: message.usage, timestamp: message.timestamp, live };
      return { ...current, items: [...current.items.filter(entry => entry.id !== id), item], liveId: live ? id : undefined };
    }
    if (type === 'message_start') {
      const item: Item = { kind: 'message', id: `live-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, role, text: parts.text, thinking: parts.thinking, toolCalls: [], timestamp: message.timestamp };
      return { ...current, items: [...current.items, item] };
    }
    return current;
  }
  if (type === 'tool_execution_start') {
    const id = String(event.toolCallId ?? '');
    if (!id) return current;
    return { ...current, tools: { ...current.tools, [id]: { name: String(event.toolName ?? 'tool'), args: event.args, status: 'running' } } };
  }
  if (type === 'tool_execution_update') {
    const id = String(event.toolCallId ?? '');
    if (!id) return current;
    const previous = current.tools[id];
    return { ...current, tools: { ...current.tools, [id]: { name: previous?.name ?? String(event.toolName ?? 'tool'), args: previous?.args ?? event.args, status: 'running', result: event.partialResult } } };
  }
  if (type === 'tool_execution_end') {
    const id = String(event.toolCallId ?? '');
    if (!id) return current;
    const previous = current.tools[id];
    return { ...current, tools: { ...current.tools, [id]: { name: previous?.name ?? String(event.toolName ?? 'tool'), args: previous?.args ?? event.args, status: event.isError ? 'error' : 'ok', result: event.result, durationMs: event.durationMs } } };
  }
  if (type === 'agent_start') return { ...current, items: [...current.items, { kind: 'note', id: `note-${Date.now()}-${Math.random()}`, label: type }] };
  if (type === 'agent_settled' || type === 'agent_end') return { ...current, items: [...current.items, { kind: 'note', id: `note-${Date.now()}-${Math.random()}`, label: type }] };
  if (type.startsWith('compaction_') || type.startsWith('auto_retry_')) return { ...current, items: [...current.items, { kind: 'note', id: `note-${Date.now()}-${Math.random()}`, label: type }] };
  return current;
}

function UsageLine({ usage }: { usage: any }) {
  const { t } = useI18n();
  if (!usage || typeof usage !== 'object') return null;
  return <div className="session-usage">{t('session.usage', { input: Number(usage.input ?? 0), output: Number(usage.output ?? 0) })}</div>;
}

function ToolCallCard({ call, state }: { call: ToolCall; state?: ToolState }) {
  const { t } = useI18n();
  const status = state?.status ?? 'running';
  const result = state?.result;
  return (
    <div className="session-tool" data-status={status}>
      <div className="session-tool-head">
        <Icon name="terminal" size={14} />
        <span className="session-tool-name">{call.name}</span>
        <span className="session-tool-state">
          {status === 'running' ? <Spinner size="sm" /> : status === 'error' ? <Icon name="close" size={13} /> : <Icon name="check" size={13} />}
        </span>
        {state?.durationMs !== undefined && <span className="session-tool-duration">{state.durationMs}ms</span>}
      </div>
      {(call.args !== undefined || state?.args !== undefined) && (
        <details className="session-detail">
          <summary>{t('session.args')}</summary>
          <pre>{pretty(call.args ?? state?.args)}</pre>
        </details>
      )}
      {result !== undefined && (
        <details className="session-detail">
          <summary>{t('session.result')}</summary>
          <pre>{resultText(result)}</pre>
        </details>
      )}
    </div>
  );
}

function MessageItem({ item, tools }: { item: Extract<Item, { kind: 'message' }>; tools: Record<string, ToolState> }) {
  const { t } = useI18n();
  if (item.role === 'system') return (
    <details className="session-system">
      <summary>{t('session.system')}</summary>
      <pre>{item.text}</pre>
    </details>
  );
  if (item.role === 'user') {
    if (item.text.length > 400) return (
      <details className="session-user-raw">
        <summary>{t('session.inputEvent')}</summary>
        <pre>{item.text}</pre>
      </details>
    );
    return (
      <div className="session-message session-user">
        <span className="session-role">{t('session.you')}</span>
        <p className="session-text">{item.text}</p>
      </div>
    );
  }
  return (
    <article className="session-message session-assistant">
      <span className="session-role">{t('session.bot')}{item.live && <span className="session-live-dot" aria-hidden="true" />}</span>
      {item.thinking && (
        <details className="session-thinking">
          <summary>{t('session.thinking')}</summary>
          <pre>{item.thinking}</pre>
        </details>
      )}
      {item.text && <div className="chat-markdown session-markdown"><Markdown remarkPlugins={[remarkGfm, remarkBreaks]}>{item.text}</Markdown></div>}
      {item.toolCalls.map(call => <ToolCallCard key={call.id} call={call} state={tools[call.id]} />)}
      {item.usage ? <UsageLine usage={item.usage} /> : null}
    </article>
  );
}

export default function SessionPanel({ bot }: { bot: BotConfig }) {
  const { token } = useAuth();
  const { t } = useI18n();
  const [data, setData] = useState<Data>({ items: [], tools: {} });
  const [connection, setConnection] = useState<'connecting' | 'live' | 'error'>('connecting');
  const [error, setError] = useState('');
  const [cursor, setCursor] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [generation, setGeneration] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const loadingOlderRef = useRef(false);
  const restoreScroll = useRef<{ height: number; top: number } | null>(null);
  const noteLabel = (label: string) => {
    const key = `session.note.${label}`;
    const translated = t(key as never);
    return translated === key ? label : translated;
  };

  useEffect(() => {
    const controller = new AbortController();
    setConnection('connecting');
    setError('');
    setData({ items: [], tools: {} });
    setCursor(0);
    setHasMore(false);
    setLoadingOlder(false);
    loadingOlderRef.current = false;
    restoreScroll.current = null;
    void streamSession(token, bot.id, controller.signal, frame => {
      if (frame.kind === 'history') {
        setData(historyData(frame.entries));
        setCursor(frame.cursor);
        setHasMore(frame.hasMore);
      } else if (frame.kind === 'agent') {
        setData(current => applyEvent(current, frame.event));
      } else if (frame.kind === 'error') {
        setError(frame.error);
        setConnection('error');
      }
    }, () => setConnection('live')).catch(cause => {
      if (controller.signal.aborted) return;
      setConnection('error');
      setError(errorText(cause));
    });
    return () => controller.abort();
  }, [bot.id, generation, token]);

  useLayoutEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    const restore = restoreScroll.current;
    if (restore) {
      viewport.scrollTop = restore.top + (viewport.scrollHeight - restore.height);
      restoreScroll.current = null;
    } else if (nearBottom.current) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }, [data, connection, loadingOlder]);

  const loadOlder = useCallback(async () => {
    if (loadingOlderRef.current || !cursor || !hasMore) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    const viewport = scrollRef.current;
    const height = viewport?.scrollHeight ?? 0;
    const top = viewport?.scrollTop ?? 0;
    try {
      const page = await sessionHistory(token, bot.id, cursor);
      if (!page.entries.length) {
        setHasMore(false);
        return;
      }
      restoreScroll.current = { height, top };
      setData(current => mergeHistory(current, historyData(page.entries)));
      setCursor(page.cursor);
      setHasMore(page.hasMore);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [bot.id, cursor, hasMore, token]);

  useEffect(() => {
    if (!hasMore || loadingOlder) return;
    const timer = window.setTimeout(() => {
      const viewport = scrollRef.current;
      if (viewport && viewport.scrollHeight <= viewport.clientHeight + 40) void loadOlder();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [data.items.length, hasMore, loadOlder, loadingOlder]);

  return (
    <div className="session-panel">
      {loadingOlder && <div className="session-older-loading" role="status"><Spinner size="sm" /></div>}
      {error && <div className="session-error" role="alert"><span>{error}</span><button type="button" className="session-reconnect" onClick={() => setGeneration(value => value + 1)}>{t('session.reconnect')}</button></div>}
      <div
        className="session-scroll"
        ref={scrollRef}
        onScroll={event => {
          const viewport = event.currentTarget;
          nearBottom.current = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop < 80;
          if (viewport.scrollTop < 100) void loadOlder();
        }}
      >
        {!data.items.length && connection === 'connecting' && <div className="session-empty"><Spinner size="sm" /></div>}
        {!data.items.length && connection !== 'connecting' && <p className="session-empty">{t('session.empty')}</p>}
        {data.items.map(item => item.kind === 'message'
          ? <MessageItem key={item.id} item={item} tools={data.tools} />
          : item.kind === 'toolResult'
            ? <div key={item.id} className="session-tool" data-status={item.isError ? 'error' : 'ok'}>
                <div className="session-tool-head"><Icon name="terminal" size={14} /><span className="session-tool-name">{item.name}</span><span className="session-tool-state"><Icon name={item.isError ? 'close' : 'check'} size={13} /></span>{item.durationMs !== undefined && <span className="session-tool-duration">{item.durationMs}ms</span>}</div>
                {item.text && <pre className="session-tool-result">{item.text}</pre>}
              </div>
            : <p key={item.id} className="session-note">{noteLabel(item.label)}{item.detail ? ` · ${item.detail}` : ''}</p>)}
      </div>
    </div>
  );
}
