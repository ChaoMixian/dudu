import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Alert, Button, Modal, Spinner } from '@heroui/react';
import Markdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import type { BotConfig, BotThreadMessage } from '../../../contracts';
import { errorText, request, segment } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { useI18n } from '../../i18n';
import { botColor } from '../../lib/bot-theme';
import BotAvatar from '../../ui/BotAvatar';

export type BotThreadFocus = { from: string; text: string; createdAt: string };

export default function BotThreadDialog({ bot, peer, isOpen, onOpenChange, focus }: { bot: BotConfig; peer: BotConfig | null; isOpen: boolean; onOpenChange: (open: boolean) => void; focus?: BotThreadFocus | null }) {
  const { token } = useAuth();
  const { t, locale } = useI18n();
  const [messages, setMessages] = useState<BotThreadMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen || !peer) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    void request<BotThreadMessage[]>(token, `/bots/${segment(bot.id)}/peers/${segment(peer.id)}/messages`)
      .then(result => { if (!cancelled) setMessages(result); })
      .catch(cause => { if (!cancelled) setError(errorText(cause)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [bot.id, isOpen, peer, token]);

  const time = (iso: string) => new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
  const focusIndex = focus && !loading && messages.length ? messages.reduce((best, message, index) => {
    if (message.from !== focus.from || message.text !== focus.text) return best;
    const delta = Math.abs(new Date(message.createdAt).getTime() - new Date(focus.createdAt).getTime());
    return delta < best.delta ? { index, delta } : best;
  }, { index: -1, delta: Number.POSITIVE_INFINITY }).index : -1;

  useLayoutEffect(() => {
    if (!isOpen || loading || !messages.length) return;
    // Let the modal finish mounting before scrolling the inner dialog body.
    const timer = window.setTimeout(() => {
      const log = logRef.current;
      const target = focusIndex >= 0 ? log?.querySelector<HTMLElement>('.bot-thread-entry[data-focused="true"]') : log?.lastElementChild as HTMLElement | null;
      target?.scrollIntoView({ block: focusIndex >= 0 ? 'center' : 'end' });
    }, 40);
    return () => window.clearTimeout(timer);
  }, [focusIndex, isOpen, loading, messages]);

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Backdrop isDismissable><Modal.Container size="lg" className="bot-thread-modal" scroll="inside" placement="center">
        <Modal.Dialog>
          <Modal.Header>
            <div className="bot-thread-header">
              <BotAvatar name={bot.name} avatar={bot.avatar} color={bot.color} size="md" />
              <span>{bot.name}</span>
              <span className="bot-thread-arrow" aria-hidden="true">↔</span>
              <BotAvatar name={peer?.name ?? '?'} avatar={peer?.avatar} color={peer?.color} size="md" />
              <span>{peer?.name ?? '—'}</span>
            </div>
          </Modal.Header>
          <Modal.Body className="flex flex-col gap-4">
            {loading && <div className="flex justify-center py-10"><Spinner size="sm" /></div>}
            {error && <Alert status="danger"><Alert.Content><Alert.Description>{error}</Alert.Description></Alert.Content></Alert>}
            {!loading && !error && !messages.length && <p className="py-10 text-center text-sm text-muted">{t('message.threadEmpty')}</p>}
            {!loading && !error && messages.length > 0 && <div className="bot-thread-log" ref={logRef}>
              {messages.map((message, index) => {
                const fromBot = message.from === bot.id;
                const sender = fromBot ? bot : peer;
                const previous = messages[index - 1];
                const showTime = !previous || new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() > 5 * 60_000;
                const palette = botColor(sender?.color, sender?.name ?? message.from);
                return <div key={message.id} className="bot-thread-entry" data-focused={index === focusIndex ? 'true' : undefined}>
                  {showTime && <div className="bot-thread-time"><time dateTime={message.createdAt}>{time(message.createdAt)}</time></div>}
                  <div className="bot-thread-sender-row"><span className="bot-thread-sender" style={{ color: palette.background }}>{sender?.name ?? message.from}</span></div>
                  <div className="bot-thread-message-row">
                    <BotAvatar name={sender?.name ?? message.from} avatar={sender?.avatar} color={sender?.color} size="xs" />
                    <div className="bot-thread-bubble chat-markdown"><Markdown remarkPlugins={[remarkGfm, remarkBreaks]}>{message.text}</Markdown></div>
                  </div>
                </div>;
              })}
            </div>}
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" className="rounded-full" onPress={() => onOpenChange(false)}>{t('message.closeThread')}</Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container></Modal.Backdrop>
    </Modal>
  );
}
