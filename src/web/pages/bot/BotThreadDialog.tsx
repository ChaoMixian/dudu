import { useEffect, useState } from 'react';
import { Alert, Button, Modal, Spinner } from '@heroui/react';
import type { BotConfig, BotThreadMessage } from '../../../contracts';
import { errorText, request, segment } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { useI18n } from '../../i18n';
import { botColor } from '../../lib/bot-theme';
import BotAvatar from '../../ui/BotAvatar';

export default function BotThreadDialog({ bot, peer, isOpen, onOpenChange }: { bot: BotConfig; peer: BotConfig | null; isOpen: boolean; onOpenChange: (open: boolean) => void }) {
  const { token } = useAuth();
  const { t, locale } = useI18n();
  const [messages, setMessages] = useState<BotThreadMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
            {!loading && !error && messages.length > 0 && <div className="bot-thread-log">
              {messages.map((message, index) => {
                const fromBot = message.from === bot.id;
                const sender = fromBot ? bot : peer;
                const previous = messages[index - 1];
                const showTime = !previous || new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() > 5 * 60_000;
                const palette = botColor(sender?.color, sender?.name ?? message.from);
                return <div key={message.id} className="bot-thread-entry">
                  {showTime && <div className="bot-thread-time"><time dateTime={message.createdAt}>{time(message.createdAt)}</time></div>}
                  <div className="bot-thread-sender-row"><span className="bot-thread-sender" style={{ color: palette.background }}>{sender?.name ?? message.from}</span></div>
                  <div className="bot-thread-message-row">
                    <BotAvatar name={sender?.name ?? message.from} avatar={sender?.avatar} color={sender?.color} size="xs" />
                    <div className="bot-thread-bubble">{message.text}</div>
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
