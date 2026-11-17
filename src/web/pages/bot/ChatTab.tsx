import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal, flushSync } from 'react-dom';
import Markdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { Button, Dropdown, Spinner, TextArea, TextField, Tooltip } from '@heroui/react';
import { useNavigate } from 'react-router-dom';
import type { BotConfig } from '../../../contracts';
import type { Message, SideTab } from '../../lib/types';
import { errorText, request, segment, uploadComposerFiles } from '../../lib/api';
import { formatBytes } from '../../lib/format';
import { botColor } from '../../lib/bot-theme';
import { randomId } from '../../lib/random';
import { useAuth } from '../../auth/AuthContext';
import { useLive } from '../../state/LiveContext';
import { useI18n } from '../../i18n';
import Icon from '../../ui/Icon';
import BotAvatar from '../../ui/BotAvatar';
import EmojiPicker from '../../ui/EmojiPicker';
import MessageAttachments from '../../ui/MessageAttachments';
import BotThreadDialog, { type BotThreadFocus } from './BotThreadDialog';

type ChatTabProps = {
  bot: BotConfig;
  onOpenSettings: () => void;
  onOpenComputers: (takeover?: boolean) => void;
  onOpenPanel?: (tab: SideTab) => void;
};

type PendingAttachment = { id: string; name: string; size: number; mime: string; workPath: string; previewUrl?: string };

const TIME_GAP = 30 * 60 * 1000;
const BOTTOM_THRESHOLD = 96;
const COMPOSER_MIN_HEIGHT = 36;
const COMPOSER_MAX_HEIGHT = 224;
const QUICK_REACTIONS = ['❤️', '👍', '👎', '😂', '🎉'];
const previewText = (message: Message) => message.text || message.attachments?.map(attachment => attachment.name).join(', ') || '';
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear()
  && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

function TypingIndicator({ summary, toolName, startedAt }: { summary?: string; toolName?: string; startedAt?: string }) {
  const { t } = useI18n();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [summary, toolName, startedAt]);
  const label = summary || (!toolName ? t('message.thinking')
    : toolName === 'bash' ? t('activity.command')
    : toolName === 'read' ? t('activity.reading')
    : toolName === 'write' || toolName === 'edit' ? t('activity.writing')
    : toolName === 'grep' || toolName === 'find' || toolName === 'ls' ? t('activity.searching')
    : toolName === 'message_send' ? t('activity.replying')
    : toolName === 'environment' ? t('activity.environment')
    : toolName === 'events_manage' ? t('activity.events')
    : toolName.startsWith('computer__') ? t('activity.computer')
    : toolName.includes('__') ? t('activity.connector', { name: toolName.split('__')[0]! })
    : t('activity.tool', { name: toolName }));
  const seconds = startedAt ? Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000)) : 0;
  const text = `${label}${seconds >= 5 ? ` · ${seconds}s` : ''}`;
  return (
    <div className="typing-row">
      <div className="typing-bubble" aria-label={text}><span /><span /><span /></div>
      <span className="typing-activity" title={text}>{text}</span>
    </div>
  );
}

export default function ChatTab({ bot, onOpenSettings, onOpenComputers, onOpenPanel }: ChatTabProps) {
  const { state, run, busy } = useLive();
  const { token } = useAuth();
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const palette = botColor(bot.color, bot.name);
  // Drafts and requests stay scoped to their bot even when navigation happens
  // before a send request resolves. The input itself is never remounted.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [askDrafts, setAskDrafts] = useState<Record<string, string>>({});
  const [sendingBots, setSendingBots] = useState<ReadonlySet<string>>(new Set());
  const sendingRef = useRef(new Set<string>());
  const composingRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const displayedBotRef = useRef(bot.id);
  const [showJump, setShowJump] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [threadPeer, setThreadPeer] = useState<BotConfig | null>(null);
  const [threadFocus, setThreadFocus] = useState<BotThreadFocus | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; message: Message; touch: boolean } | null>(null);
  const [composerStacked, setComposerStacked] = useState(false);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [emojiTarget, setEmojiTarget] = useState<Message | null>(null);
  const [pending, setPending] = useState<Record<string, PendingAttachment[]>>({});
  const [uploadingBots, setUploadingBots] = useState<ReadonlySet<string>>(new Set());
  const [uploadError, setUploadError] = useState('');
  const [dragging, setDragging] = useState(false);
  const uploadingRef = useRef(new Set<string>());
  const pendingRef = useRef<Record<string, PendingAttachment[]>>({});
  const dragDepth = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const composerLineHeight = useRef(0);
  const layoutFlip = useRef<{ shell?: DOMRect; plus?: DOMRect; actions?: DOMRect; field?: DOMRect } | null>(null);
  const longPressRef = useRef<{ timer: number; pointerId: number; x: number; y: number } | null>(null);
  const text = drafts[bot.id] ?? '';
  const pendingFiles = pending[bot.id] ?? [];
  const uploading = uploadingBots.has(bot.id);
  const advanced = state.advancedMode === true;
  const sending = sendingBots.has(bot.id);
  const conversation = useMemo(() => state.messages
    .filter(message => message.botId === bot.id && message.conversationId === 'default')
    .sort((a, b) => a.seq - b.seq), [state.messages, bot.id]);
  const messages = useMemo(() => conversation.filter(message => message.kind !== 'reaction'), [conversation]);
  const reactions = useMemo(() => {
    const byTarget = new Map<string, Map<string, { count: number }>>();
    for (const message of conversation) {
      if (message.kind !== 'reaction' || !message.targetId || !message.emoji) continue;
      const counts = byTarget.get(message.targetId) ?? new Map<string, { count: number }>();
      const current = counts.get(message.emoji) ?? { count: 0 };
      counts.set(message.emoji, { count: current.count + 1 });
      byTarget.set(message.targetId, counts);
    }
    return new Map([...byTarget].map(([target, counts]) => [target, [...counts].map(([emoji, value]) => ({ emoji, ...value }))]));
  }, [conversation]);
  const messageById = useMemo(() => new Map(conversation.map(message => [message.id, message])), [conversation]);
  const lastUserSeq = useMemo(() => messages.reduce((latest, message) => message.sender === 'user' ? Math.max(latest, message.seq) : latest, 0), [messages]);
  const threads = useMemo(() => (state.botThreads ?? []).filter(thread => thread.botId === bot.id && thread.peerId !== bot.id && state.bots.some(entry => entry.id === thread.peerId)), [state.botThreads, state.bots, bot.id]);
  const peerFor = (peerId: string | undefined) => peerId ? state.bots.find(entry => entry.id === peerId) : undefined;
  const botStatus = state.statuses.find(entry => entry.botId === bot.id);
  const thinking = botStatus?.state === 'running';
  const activitySummary = botStatus?.activity?.summary;
  const activityTool = botStatus?.activity?.toolName;
  const activityStartedAt = botStatus?.activity?.startedAt;
  const replyMessage = replyTo ? messageById.get(replyTo) : undefined;
  const canSend = Boolean(text.trim() || pendingFiles.length);
  const sendDisabled = !canSend || sending || Boolean(busy) || uploading;
  const modelChoices = useMemo(() => state.providers.flatMap(provider => provider.models.map(model => ({
    key: `${provider.id}|${model.id}`,
    provider: provider.id,
    providerName: provider.name || provider.id,
    model: model.id,
    label: model.name && model.name !== model.id ? model.name : model.id,
  }))), [state.providers]);
  const activeProvider = bot.provider ?? state.defaults?.provider;
  const activeModel = bot.model ?? state.defaults?.model;
  const activeChoice = modelChoices.find(choice => choice.provider === activeProvider && choice.model === activeModel);
  const defaultChoice = modelChoices.find(choice => choice.provider === state.defaults?.provider && choice.model === state.defaults?.model);
  const dateLocale = locale === 'zh' ? 'zh-CN' : 'en';
  const timeFormat = useMemo(() => new Intl.DateTimeFormat(dateLocale, {
    hour: 'numeric', minute: '2-digit',
  }), [dateLocale]);
  const dateFormat = useMemo(() => new Intl.DateTimeFormat(dateLocale, {
    year: 'numeric', month: 'short', day: 'numeric',
  }), [dateLocale]);

  const jumpToBottom = () => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    nearBottomRef.current = true;
    viewport.scrollTop = viewport.scrollHeight;
    setShowJump(false);
  };

  useLayoutEffect(() => {
    if (displayedBotRef.current !== bot.id) {
      displayedBotRef.current = bot.id;
      nearBottomRef.current = true;
      composingRef.current = false;
    }
    const viewport = scrollRef.current;
    if (!viewport) return;
    if (nearBottomRef.current) {
      viewport.scrollTop = viewport.scrollHeight;
      setShowJump(false);
    } else {
      setShowJump(viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop > BOTTOM_THRESHOLD);
    }
  }, [bot.id, messages, thinking]);

  useEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    // Resizing the composer or mobile keyboard must not pull a reader away
    // from history; follow the latest message only when already near bottom.
    const observer = new ResizeObserver(() => {
      if (nearBottomRef.current) viewport.scrollTop = viewport.scrollHeight;
      setShowJump(!nearBottomRef.current
        && viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop > BOTTOM_THRESHOLD);
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => { pendingRef.current = pending; }, [pending]);
  useEffect(() => () => {
    for (const list of Object.values(pendingRef.current)) for (const item of list) if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  }, []);

  const addFiles = async (input: FileList | File[]) => {
    const files = Array.from(input);
    if (!files.length) return;
    const botId = bot.id;
    const current = pending[botId] ?? [];
    const room = 8 - current.length;
    if (room <= 0) { setUploadError(t('composer.limit')); return; }
    const oversized = files.find(file => file.size > 50 * 1024 * 1024);
    if (oversized) { setUploadError(t('composer.tooLarge', { name: oversized.name })); return; }
    const chosen = files.slice(0, room);
    setUploadError(files.length > room ? t('composer.limit') : '');
    uploadingRef.current.add(botId);
    setUploadingBots(new Set(uploadingRef.current));
    try {
      const uploaded = await uploadComposerFiles(token, botId, chosen);
      const next: PendingAttachment[] = uploaded.map((item, index) => {
        const source = chosen[index];
        return {
          id: randomId(),
          name: item.name,
          size: item.size,
          mime: item.mime,
          workPath: item.workPath ?? item.path.replace(/^work\//, ''),
          previewUrl: source?.type.startsWith('image/') ? URL.createObjectURL(source) : undefined,
        };
      });
      setPending(state => ({ ...state, [botId]: [...(state[botId] ?? []), ...next] }));
    } catch (cause) {
      setUploadError(errorText(cause));
    } finally {
      uploadingRef.current.delete(botId);
      setUploadingBots(new Set(uploadingRef.current));
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removePending = (id: string) => {
    const botId = bot.id;
    const item = (pending[botId] ?? []).find(entry => entry.id === id);
    if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
    setPending(current => ({ ...current, [botId]: (current[botId] ?? []).filter(entry => entry.id !== id) }));
  };

  const send = async (override?: string) => {
    const content = (override ?? text).trim();
    const botId = bot.id;
    const files = pending[botId] ?? [];
    if ((!content && !files.length) || busy || (!override && composingRef.current) || sendingRef.current.has(botId) || uploadingRef.current.has(botId)) return;
    sendingRef.current.add(botId);
    setSendingBots(new Set(sendingRef.current));
    try {
      const succeeded = await run(t('message.send'), () => request(token, '/messages', 'POST', {
        botId, text: content, conversationId: 'default', ...(replyTo ? { replyTo } : {}),
        ...(files.length ? { attachments: files.map(item => ({ path: item.workPath, name: item.name })) } : {}),
      }));
      if (succeeded) {
        setReplyTo(null);
        if (!override) setDrafts(current => current[botId] === text ? { ...current, [botId]: '' } : current);
        for (const item of files) if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
        setPending(current => ({ ...current, [botId]: [] }));
        setUploadError('');
      }
    } finally {
      sendingRef.current.delete(botId);
      setSendingBots(new Set(sendingRef.current));
    }
  };

  const answerAsk = async (messageId: string, value: string) => {
    const content = value.trim();
    if (!content || sending) return;
    setAskDrafts(current => ({ ...current, [messageId]: '' }));
    await send(content);
  };

  const toggleReaction = async (message: Message, emoji: string) => {
    setMenu(null);
    setEmojiTarget(null);
    await run('', () => request(token, '/reactions', 'POST', { botId: bot.id, messageId: message.id, emoji }));
  };

  const copyText = async (value: string) => {
    try { await navigator.clipboard.writeText(value); }
    catch {
      const area = document.createElement('textarea');
      area.value = value;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
  };

  const startReply = (message: Message) => {
    setReplyTo(message.id);
    setMenu(null);
    requestAnimationFrame(() => composerRef.current?.focus());
  };

  const openMenu = (event: ReactMouseEvent, message: Message) => {
    event.preventDefault();
    clearLongPress();
    setMenu({ x: event.clientX, y: event.clientY, message, touch: false });
  };

  const clearLongPress = () => {
    if (longPressRef.current) window.clearTimeout(longPressRef.current.timer);
    longPressRef.current = null;
  };

  const startLongPress = (event: ReactPointerEvent, message: Message) => {
    if (event.pointerType === 'mouse' || selectingId === message.id) return;
    const target = event.target as HTMLElement;
    if (target.closest('a,button,input,textarea,[role="button"],img')) return;
    clearLongPress();
    const { clientX, clientY, pointerId } = event;
    const timer = window.setTimeout(() => {
      longPressRef.current = null;
      setMenu({ x: clientX, y: clientY, message, touch: true });
    }, 450);
    longPressRef.current = { timer, pointerId, x: clientX, y: clientY };
  };

  const moveLongPress = (event: ReactPointerEvent) => {
    const press = longPressRef.current;
    if (!press || press.pointerId !== event.pointerId) return;
    if (Math.abs(event.clientX - press.x) > 8 || Math.abs(event.clientY - press.y) > 8) clearLongPress();
  };

  const selectText = (message: Message) => {
    setMenu(null);
    flushSync(() => setSelectingId(message.id));
    const bubble = document.querySelector(`.chat-bubble-wrap[data-message-id="${CSS.escape(message.id)}"] .chat-bubble`);
    if (!bubble) return;
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(bubble);
    selection?.removeAllRanges();
    selection?.addRange(range);
  };

  useEffect(() => () => clearLongPress(), []);

  useEffect(() => {
    if (!selectingId) return;
    const clear = (event: PointerEvent) => {
      if ((event.target as HTMLElement | null)?.closest(`.chat-bubble-wrap[data-message-id="${CSS.escape(selectingId)}"]`)) return;
      setSelectingId(null);
    };
    document.addEventListener('pointerdown', clear);
    return () => document.removeEventListener('pointerdown', clear);
  }, [selectingId]);

  useLayoutEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const height = el.scrollHeight;
    if (!text) composerLineHeight.current = height;
    const next = Math.min(COMPOSER_MAX_HEIGHT, Math.max(COMPOSER_MIN_HEIGHT, height));
    el.style.height = `${next}px`;
    el.style.overflowY = height > COMPOSER_MAX_HEIGHT ? 'auto' : 'hidden';
    const shell = el.closest('.composer-shell') as HTMLElement | null;
    const row = el.closest('.composer-row') as HTMLElement | null;
    const plus = shell?.querySelector<HTMLElement>('.composer-plus') ?? null;
    const actions = shell?.querySelector<HTMLElement>('.composer-actions') ?? null;
    let inlineHeight = height;
    if (composerStacked && row) {
      // Measure the same text at the width it will have in the inline layout;
      // this lets a message collapse back after it is shortened.
      const inlineWidth = Math.max(60, row.clientWidth - (plus?.offsetWidth ?? 0) - (actions?.offsetWidth ?? 0) - 12);
      const previousWidth = el.style.width;
      el.style.width = `${inlineWidth}px`;
      el.style.height = 'auto';
      inlineHeight = el.scrollHeight;
      el.style.width = previousWidth;
      el.style.height = `${next}px`;
    }
    const baseline = composerLineHeight.current || COMPOSER_MIN_HEIGHT + 2;
    const desired = text ? (text.includes('\n') || inlineHeight > baseline + 2) : false;
    if (desired === composerStacked) return;
    layoutFlip.current = {
      shell: shell?.getBoundingClientRect(),
      plus: plus?.getBoundingClientRect(),
      actions: actions?.getBoundingClientRect(),
      field: el.getBoundingClientRect(),
    };
    setComposerStacked(desired);
  }, [text, bot.id, composerStacked]);

  useLayoutEffect(() => {
    const before = layoutFlip.current;
    if (!before) return;
    layoutFlip.current = null;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const el = composerRef.current;
    const shell = el?.closest('.composer-shell') as HTMLElement | null;
    if (!el || !shell) return;
    const plus = shell.querySelector<HTMLElement>('.composer-plus');
    const actions = shell.querySelector<HTMLElement>('.composer-actions');
    const after = {
      shell: shell.getBoundingClientRect(),
      plus: plus?.getBoundingClientRect(),
      actions: actions?.getBoundingClientRect(),
      field: el.getBoundingClientRect(),
    };
    const easing = 'cubic-bezier(0.22, 1, 0.36, 1)';
    if (before.shell && before.shell.height !== after.shell.height) {
      const previousOverflow = shell.style.overflow;
      shell.style.overflow = 'hidden';
      const animation = shell.animate([
        { height: `${before.shell.height}px` },
        { height: `${after.shell.height}px` },
      ], { duration: 200, easing });
      animation.finished.catch(() => {}).finally(() => { shell.style.overflow = previousOverflow; });
    }
    if (before.field && before.field.width !== after.field.width) {
      el.animate([
        { width: `${before.field.width}px` },
        { width: `${after.field.width}px` },
      ], { duration: 200, easing });
    }
    const flip = (node: HTMLElement | null, last?: DOMRect, next?: DOMRect) => {
      if (!node || !last || !next) return;
      const x = last.left - next.left;
      const y = last.top - next.top;
      if (Math.abs(x) < 1 && Math.abs(y) < 1) return;
      node.animate([
        { transform: `translate(${x}px, ${y}px)` },
        { transform: 'translate(0, 0)' },
      ], { duration: 200, easing });
    };
    flip(plus, before.plus, after.plus);
    flip(actions, before.actions, after.actions);
  }, [composerStacked]);

  useLayoutEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport || !nearBottomRef.current) return;
    // The composer has just changed height; keep the last message at the same
    // distance from the composer instead of leaving it clipped behind it.
    viewport.scrollTop = viewport.scrollHeight;
  }, [text, composerStacked]);

  useEffect(() => {
    if (!menu) return;
    const close = (event: Event) => { if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenu(null); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenu(null); };
    document.addEventListener('pointerdown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('keydown', key);
    };
  }, [menu]);

  const chooseModel = async (key: string) => {
    const next = key === 'default' ? { provider: undefined, model: undefined } : (() => {
      const choice = modelChoices.find(item => item.key === key);
      return choice ? { provider: choice.provider, model: choice.model } : null;
    })();
    if (!next) return;
    await run(t('bot.save'), () => request(token, `/bots/${segment(bot.id)}`, 'PUT', { ...bot, ...next }));
  };

  const openThread = (peer: BotConfig, focus?: BotThreadFocus) => {
    setThreadPeer(peer);
    setThreadFocus(focus ?? null);
  };
  const timestamp = (date: Date) => {
    if (!Number.isFinite(date.getTime())) return '';
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const day = sameDay(date, today) ? t('ui.today')
      : sameDay(date, yesterday) ? t('ui.yesterday') : dateFormat.format(date);
    return `${day} · ${timeFormat.format(date)}`;
  };

  return (
    <section
      className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col"
      aria-label={t('bot.chat')}
      onDragEnter={event => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={event => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDragging(false);
      }}
      onDrop={event => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        void addFiles(event.dataTransfer.files);
      }}
    >
      {dragging && <div className="chat-drop-overlay" aria-hidden="true"><Icon name="upload" size={26} /><span>{t('composer.drop')}</span></div>}
      {threads.length > 0 && (
        <div className="bot-thread-strip">
          <span className="bot-thread-strip-label">{t('message.botThreads')}</span>
          {threads.map(thread => {
            const peer = peerFor(thread.peerId);
            if (!peer) return null;
            return <button key={thread.peerId} type="button" className="bot-thread-chip" onClick={() => openThread(peer)}>
              <BotAvatar name={peer.name} avatar={peer.avatar} color={peer.color} size="xs" />
              <span>{peer.name}</span>
              <span className="bot-thread-count">{thread.count}</span>
            </button>;
          })}
        </div>
      )}
      <div
        ref={scrollRef}
        className="chat-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain [overflow-anchor:none]"
        onScroll={event => {
          const viewport = event.currentTarget;
          const nearBottom = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= BOTTOM_THRESHOLD;
          nearBottomRef.current = nearBottom;
          setShowJump(!nearBottom);
        }}
      >
        {!messages.length ? (
          <div className="flex min-h-full items-center justify-center p-6">
            <div className="flex max-w-sm flex-col items-center gap-3 text-center">
              <BotAvatar name={bot.name} avatar={bot.avatar} color={bot.color} size="lg" />
              <h2 className="text-xl font-semibold tracking-tight">{bot.name}</h2>
              <p className="text-sm text-muted">{bot.description || t('bot.emptyChat', { name: bot.name })}</p>
              {thinking && <TypingIndicator summary={activitySummary} toolName={activityTool} startedAt={activityStartedAt} />}
            </div>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-4xl px-4 py-8 md:px-8" role="log" aria-label={t('bot.chat')} aria-relevant="additions text">
            {messages.map((message, index) => {
              const previous = messages[index - 1];
              const date = new Date(message.createdAt);
              const previousDate = previous ? new Date(previous.createdAt) : null;
              const separates = !previousDate || !sameDay(previousDate, date)
                || date.getTime() - previousDate.getTime() >= TIME_GAP;
              if (message.kind === 'bot_out' || message.kind === 'bot_in') {
                const peer = peerFor(message.targetId);
                if (!peer || peer.id === bot.id) return null;
                return <Fragment key={`${bot.id}:${message.id}`}>
                  {separates && <div className="my-7 text-center text-[11px] font-medium uppercase tracking-wide text-muted"><time dateTime={message.createdAt}>{timestamp(date)}</time></div>}
                  <div className="bot-thread-notice-row">
                    <button type="button" className="bot-thread-notice" onClick={() => openThread(peer, { from: message.sender, text: message.text, createdAt: message.createdAt })}>
                      <BotAvatar name={peer.name} avatar={peer.avatar} color={peer.color} size="xs" />
                      <span>{t(message.kind === 'bot_out' ? 'message.sentTo' : 'message.receivedFrom', { name: peer.name })}</span>
                    </button>
                  </div>
                </Fragment>;
              }
              const consecutive = !separates && previous?.sender === message.sender;
              const next = messages[index + 1];
              const nextDate = next ? new Date(next.createdAt) : null;
              const nextSeparates = !next || !nextDate || !sameDay(nextDate, date)
                || nextDate.getTime() - date.getTime() >= TIME_GAP;
              const groupEnd = !next || next.sender !== message.sender || nextSeparates;
              const own = message.sender !== bot.id;
              const answered = message.sender === bot.id && message.seq < lastUserSeq;
              const messageReactions = reactions.get(message.id);
              const replied = message.replyTo ? messageById.get(message.replyTo) : undefined;
              const canReact = message.sender === bot.id;
              return (
                <Fragment key={`${bot.id}:${message.id}`}>
                  {separates && <div className="my-7 text-center text-[11px] font-medium uppercase tracking-wide text-muted"><time dateTime={message.createdAt}>{timestamp(date)}</time></div>}
                  <div className={`flex ${own ? 'justify-end' : 'justify-start'} ${consecutive ? 'mt-1.5' : 'mt-4'}`}>
                    <div className={`flex min-w-0 max-w-[82%] flex-col gap-1.5 ${own ? 'items-end' : 'items-start'}`}>
                      <div
                        className={`chat-bubble-wrap ${messageReactions?.length ? 'has-reactions' : ''}`}
                        data-react-side={own ? 'left' : 'right'}
                        data-message-id={message.id}
                        data-selecting={selectingId === message.id ? 'true' : undefined}
                        onContextMenu={event => {
                          const touch = (event.nativeEvent as MouseEvent & { sourceCapabilities?: { firesTouchEvents?: boolean } }).sourceCapabilities?.firesTouchEvents === true;
                          if (touch) {
                            const target = event.target as HTMLElement;
                            if (target.closest('a,button,input,textarea,[role="button"],img')) return;
                            // The touch long-press timer owns this gesture; suppress native selection/callout.
                            event.preventDefault();
                            return;
                          }
                          openMenu(event, message);
                        }}
                        onPointerDown={event => startLongPress(event, message)}
                        onPointerMove={moveLongPress}
                        onPointerUp={clearLongPress}
                        onPointerCancel={clearLongPress}
                        onPointerLeave={clearLongPress}
                      >
                        {!!messageReactions?.length && (
                          <div className="message-reactions" aria-label={t('message.reactions')}>
                            {messageReactions.map(({ emoji, count }) => canReact
                              ? <button key={emoji} type="button" className="message-reaction" title={t('message.reactToggle')} onClick={() => void toggleReaction(message, emoji)}>{emoji}{count > 1 && <span className="message-reaction-count">{count}</span>}</button>
                              : <span key={emoji} className="message-reaction">{emoji}{count > 1 && <span className="message-reaction-count">{count}</span>}</span>)}
                          </div>
                        )}
                        <div
                          className={`chat-bubble ${own ? 'chat-bubble-user' : 'chat-bubble-assistant'} ${consecutive ? '' : 'group-start'} ${groupEnd ? 'group-end' : ''}`}
                          style={own ? { background: palette.background, color: palette.foreground } : undefined}
                          title={timestamp(date)}
                        >
                          {replied && <div className="reply-quote"><span>{replied.sender === bot.id ? bot.name : t('message.you')}</span><p className="chat-selectable">{previewText(replied).slice(0, 160)}</p></div>}
                          {message.text && (own
                            ? <p className="chat-selectable whitespace-pre-wrap break-words text-[14.5px] leading-relaxed [overflow-wrap:anywhere]">{message.text}</p>
                            : <div className="chat-markdown chat-selectable text-[14.5px] leading-relaxed"><Markdown remarkPlugins={[remarkGfm, remarkBreaks]}>{message.text}</Markdown></div>)}
                          <MessageAttachments attachments={message.attachments} />
                        </div>
                      </div>
                      {message.status === 'failed' && (
                        <span role="status" className="flex items-center gap-1 text-xs text-muted"><Icon name="close" size={12} />{t('message.failed')}</span>
                      )}
                      {!own && message.kind === 'message' && index === messages.length - 1 && !answered && !!message.options?.length && (
                        <div className="message-options">
                          {message.options.map(option => (
                            <button key={option} type="button" className="message-option" disabled={sending} onClick={() => void send(option)}>{option}</button>
                          ))}
                        </div>
                      )}
                      {!own && message.kind === 'ask' && !answered && (
                        <div className="ask-options">
                          {message.options?.map(option => (
                            <button key={option} type="button" className="ask-option" disabled={sending} onClick={() => void send(option)}>
                              <span>{option}</span><Icon name="chevron" size={14} />
                            </button>
                          ))}
                          <form className="ask-free" onSubmit={event => { event.preventDefault(); void answerAsk(message.id, askDrafts[message.id] ?? ''); }}>
                            <input
                              className="ask-free-input"
                              value={askDrafts[message.id] ?? ''}
                              onChange={event => setAskDrafts(current => ({ ...current, [message.id]: event.target.value }))}
                              placeholder={t('message.askPlaceholder')}
                              aria-label={t('message.askPlaceholder')}
                              disabled={sending}
                            />
                            <button type="submit" className="ask-free-send" disabled={sending || !(askDrafts[message.id] ?? '').trim()} aria-label={t('message.askSubmit')}>
                              <Icon name="arrowUp" size={15} />
                            </button>
                          </form>
                        </div>
                      )}
                      {!own && message.kind === 'takeover' && (
                        <div className="takeover-card">
                          <span className="takeover-icon"><Icon name="monitor" size={18} /></span>
                          <span className="min-w-0 flex-1">
                            <span className="takeover-title">{t('message.takeoverTitle')}</span>
                            <span className="takeover-hint">{t('message.takeoverHint')}</span>
                          </span>
                          <Button size="sm" variant="secondary" className="rounded-full" onPress={() => onOpenComputers(true)}>{t('message.takeoverOpen')}</Button>
                        </div>
                      )}
                    </div>
                  </div>
                </Fragment>
              );
            })}
            {thinking && <TypingIndicator summary={activitySummary} toolName={activityTool} startedAt={activityStartedAt} />}
          </div>
        )}
      </div>

      <div className="chat-composer relative mx-auto w-full max-w-4xl shrink-0 px-4 md:px-8" aria-busy={sending}>
        {showJump && <div className="absolute inset-x-0 bottom-full flex justify-center pb-3">
          <Tooltip>
            <Button isIconOnly size="sm" variant="secondary" className="rounded-full" onPress={jumpToBottom} aria-label={t('ui.jumpBottom')}><Icon name="arrowUp" size={16} className="rotate-180" /></Button>
            <Tooltip.Content>{t('ui.jumpBottom')}</Tooltip.Content>
          </Tooltip>
        </div>}
        <div className="composer-shell" data-stacked={composerStacked ? 'true' : undefined}>
          {replyMessage && (
            <div className="composer-reply-inline">
              <span className="composer-reply-text">{previewText(replyMessage)}</span>
              <button type="button" className="composer-reply-close" aria-label={t('common.cancel')} onClick={() => setReplyTo(null)}><Icon name="close" size={14} /></button>
            </div>
          )}
          {pendingFiles.length > 0 && (
            <div className="composer-attachments">
              {pendingFiles.map(item => (
                <div className="composer-attachment" key={item.id}>
                  {item.previewUrl
                    ? <img className="composer-attachment-thumb" src={item.previewUrl} alt="" />
                    : <span className="composer-attachment-icon"><Icon name={item.mime.startsWith('image/') ? 'image' : 'file'} size={15} /></span>}
                  <span className="composer-attachment-meta">
                    <span className="composer-attachment-name" title={item.name}>{item.name}</span>
                    <span className="composer-attachment-size">{formatBytes(item.size)}</span>
                  </span>
                  <button type="button" className="composer-attachment-remove" aria-label={t('composer.remove', { name: item.name })} onClick={() => removePending(item.id)}><Icon name="close" size={12} /></button>
                </div>
              ))}
            </div>
          )}
          {uploadError && <p className="composer-upload-error" role="alert">{uploadError}</p>}
          <div className="composer-row">
            <input ref={fileInputRef} type="file" multiple hidden onChange={event => { if (event.target.files) void addFiles(event.target.files); }} />
            <Dropdown>
              <Button isIconOnly size="sm" variant="ghost" className="composer-plus rounded-full" aria-label={t('ui.addTools')}><Icon name="plus" size={20} /></Button>
              <Dropdown.Popover placement="top start">
                <Dropdown.Menu aria-label={t('ui.addTools')} onAction={key => {
                  if (key === 'upload') fileInputRef.current?.click();
                  if (key === 'files') onOpenPanel?.('files');
                  if (key === 'terminal') onOpenPanel?.('terminal');
                  if (key === 'session') onOpenPanel?.('session');
                  if (key === 'settings') onOpenSettings();
                  if (key === 'computers') onOpenComputers();
                }}>
                  <Dropdown.Item id="upload" textValue={t('composer.upload')}><Icon name="paperclip" size={18} /><span>{t('composer.upload')}</span></Dropdown.Item>
                  {advanced && onOpenPanel && <Dropdown.Item id="files" textValue={t('panel.files')}><Icon name="folder" size={18} /><span>{t('panel.files')}</span></Dropdown.Item>}
                  {advanced && onOpenPanel && <Dropdown.Item id="terminal" textValue={t('panel.terminal')}><Icon name="terminal" size={18} /><span>{t('panel.terminal')}</span></Dropdown.Item>}
                  {advanced && onOpenPanel && <Dropdown.Item id="session" textValue={t('panel.session')}><Icon name="session" size={18} /><span>{t('panel.session')}</span></Dropdown.Item>}
                  <Dropdown.Item id="settings" textValue={t('bot.settings')}><Icon name="settings" size={18} /><span>{t('bot.settings')}</span></Dropdown.Item>
                  <Dropdown.Item id="computers" textValue={t('bot.computers')}><Icon name="monitor" size={18} /><span>{t('bot.computers')}</span></Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
            <TextField className="composer-field" value={text} onChange={value => setDrafts(current => ({ ...current, [bot.id]: value }))} aria-label={t('ui.messageTo', { name: bot.name })}>
              <TextArea
                ref={composerRef}
                rows={1}
                className="composer-input max-h-56 w-full resize-none"
                placeholder={t(replyMessage ? 'message.replyPlaceholder' : 'message.composerEmpty')}
                aria-describedby="chat-send-hint"
                onCompositionStart={() => { composingRef.current = true; }}
                onCompositionEnd={() => { composingRef.current = false; }}
                onPaste={event => {
                  const files = Array.from(event.clipboardData.files ?? []);
                  if (!files.length) return;
                  event.preventDefault();
                  void addFiles(files);
                }}
                onKeyDown={event => {
                  if (event.key === 'Enter' && !event.shiftKey && !composingRef.current
                    && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
                    event.preventDefault();
                    void send();
                  }
                }}
              />
            </TextField>
            <div className="composer-actions">
              <div className="flex min-w-0 items-center gap-1.5">
                {modelChoices.length ? (
                  <Dropdown>
                    <Button size="sm" variant="ghost" className="composer-model" aria-label={t('bot.model')}>
                      <span className="max-w-36 truncate">{activeChoice?.label ?? activeModel ?? t('bot.chooseModel')}</span>
                      <Icon name="chevron" size={13} className="rotate-90 opacity-60" />
                    </Button>
                    <Dropdown.Popover placement="top end">
                      <Dropdown.Menu aria-label={t('bot.model')} onAction={key => void chooseModel(String(key))}>
                        {defaultChoice && <Dropdown.Item id="default" textValue={`${t('bot.followDefault')} ${defaultChoice.label}`}>
                          <Icon name="sparkles" size={15} /><span className="truncate">{t('bot.followDefault')} · {defaultChoice.label}</span>
                          {!bot.provider && !bot.model && <Icon name="check" size={14} className="ml-auto" />}
                        </Dropdown.Item>}
                        {modelChoices.map(choice => <Dropdown.Item key={choice.key} id={choice.key} textValue={`${choice.providerName} ${choice.label}`}>
                          <span className="truncate">{choice.providerName} · {choice.label}</span>
                          {choice.key === activeChoice?.key && bot.model === choice.model && <Icon name="check" size={14} className="ml-auto" />}
                        </Dropdown.Item>)}
                      </Dropdown.Menu>
                    </Dropdown.Popover>
                  </Dropdown>
                ) : (
                  <Button size="sm" variant="ghost" className="composer-model" onPress={() => navigate('/settings/providers')}>{t('bot.configureModel')}</Button>
                )}
                <Tooltip>
                  <Button isIconOnly size="sm" variant="primary" className="size-9 rounded-full" isDisabled={sendDisabled} onPress={() => void send()} aria-label={sending ? t('message.sending') : canSend ? t('message.send') : t('message.composerEmpty')}>
                    {sending ? <Spinner size="sm" /> : <Icon name="arrowUp" size={18} />}
                  </Button>
                  <Tooltip.Content>{sending ? t('message.sending') : uploading ? t('composer.uploading') : busy || canSend ? t('message.send') : t('message.composerEmpty')}</Tooltip.Content>
                </Tooltip>
              </div>
            </div>
          </div>
        </div>
        <p id="chat-send-hint" className="sr-only">{t('message.composer', { name: bot.name })}</p>
      </div>

      {menu && createPortal(
        <div
          ref={menuRef}
          className="message-menu"
          role="menu"
          style={{
            left: Math.max(8, Math.min(menu.x, window.innerWidth - 264)),
            top: Math.max(8, Math.min(menu.y, window.innerHeight - (menu.message.sender === bot.id ? 310 : 210))),
          }}
        >
          {menu.message.sender === bot.id && (
            <div className="message-menu-emojis">
              {QUICK_REACTIONS.map(emoji => (
                <button key={emoji} type="button" className="message-menu-emoji" onClick={() => void toggleReaction(menu.message, emoji)}>{emoji}</button>
              ))}
              <button type="button" className="message-menu-emoji message-menu-more" aria-label={t('message.emojiTitle')} onClick={() => { setEmojiTarget(menu.message); setMenu(null); }}><Icon name="smile" size={17} /></button>
            </div>
          )}
          <button type="button" className="message-menu-action" role="menuitem" onClick={() => startReply(menu.message)}><Icon name="reply" size={17} />{t('message.reply')}</button>
          {menu.touch && <button type="button" className="message-menu-action" role="menuitem" onClick={() => selectText(menu.message)}><Icon name="edit" size={17} />{t('message.selectText')}</button>}
          <button type="button" className="message-menu-action" role="menuitem" onClick={() => { void copyText(menu.message.text); setMenu(null); }}><Icon name="copy" size={17} />{t('message.copy')}</button>
          <button type="button" className="message-menu-action" role="menuitem" onClick={() => { void copyText(menu.message.id); setMenu(null); }}><Icon name="copy" size={17} />{t('message.copyRequestId')}</button>
        </div>,
        document.body,
      )}
      <EmojiPicker isOpen={!!emojiTarget} onOpenChange={open => { if (!open) setEmojiTarget(null); }} onPick={emoji => { if (emojiTarget) void toggleReaction(emojiTarget, emoji); }} />
      <BotThreadDialog bot={bot} peer={threadPeer} isOpen={!!threadPeer} focus={threadFocus} onOpenChange={open => { if (!open) { setThreadPeer(null); setThreadFocus(null); } }} />
    </section>
  );
}
