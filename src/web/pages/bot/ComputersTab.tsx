import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Spinner } from '@heroui/react';
import { Hand, MonitorPlay, Play, RefreshCw, Square } from 'lucide-react';
import type { BotConfig, DesktopStatus } from '../../../contracts';
import { errorText } from '../../lib/api';
import { computerAction, computerStatus, computerWatch, type ComputerAction, type ComputerWatch } from '../../lib/computers';
import { useAuth } from '../../auth/AuthContext';
import { useI18n } from '../../i18n';

type Operation = ComputerAction | 'refresh';

function friendlyError(cause: unknown, t: (key: 'computer.serviceOffline') => string): string {
  const message = errorText(cause);
  if (/ECONNREFUSED|Unable to connect|fetch failed/i.test(message)) return t('computer.serviceOffline');
  return message;
}

export default function ComputersTab({ bot, autoTakeover = false }: { bot: BotConfig; autoTakeover?: boolean }) {
  const { token } = useAuth();
  const { t } = useI18n();
  const bindingId = bot.bindings.find(binding => binding.connectorId === 'computer')?.id ?? 'computer';
  const [status, setStatus] = useState<DesktopStatus>();
  const [watch, setWatch] = useState<ComputerWatch>();
  const [error, setError] = useState('');
  const [pending, setPending] = useState<Operation>();
  const [frameKey, setFrameKey] = useState(0);
  const [takeoverRequested, setTakeoverRequested] = useState(false);
  const requestRef = useRef<AbortController | undefined>(undefined);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const autoTakeoverRef = useRef(false);

  const load = useCallback(async (controller: AbortController) => {
    let next: DesktopStatus;
    try {
      next = await computerStatus(token, bot.id, bindingId, controller.signal);
    } catch (cause) {
      if (controller.signal.aborted) return;
      // A desktop that has never been started is a normal stopped state, not an error.
      if (/Unknown desktop/i.test(errorText(cause))) {
        setStatus({ id: bindingId, botId: bot.id, width: 1280, height: 800, state: 'stopped' });
        setWatch(undefined);
        return;
      }
      throw cause;
    }
    if (controller.signal.aborted) return;
    setStatus(next);
    if (next.state !== 'ready') { setWatch(undefined); return; }
    try {
      const info = await computerWatch(token, bot.id, bindingId, controller.signal);
      if (!controller.signal.aborted) setWatch(info);
    } catch { if (!controller.signal.aborted) setWatch(undefined); }
  }, [bindingId, bot.id, token]);

  const execute = useCallback(async (operation: Operation) => {
    if (requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setPending(operation);
    setError('');
    try {
      if (operation === 'start' || operation === 'stop' || operation === 'takeover') {
        if (operation !== 'takeover') setWatch(undefined);
        await computerAction(token, bot.id, bindingId, operation, controller.signal);
        if (operation === 'takeover') {
          setTakeoverRequested(true);
          frameRef.current?.focus();
        }
      }
      await load(controller);
      if (operation === 'refresh' || operation === 'start') setFrameKey(key => key + 1);
    } catch (cause) {
      if (!controller.signal.aborted) setError(friendlyError(cause, t));
    } finally {
      if (requestRef.current === controller) { requestRef.current = undefined; setPending(undefined); }
    }
  }, [bindingId, bot.id, load, token]);

  useEffect(() => {
    const controller = new AbortController();
    setError('');
    setWatch(undefined);
    setTakeoverRequested(false);
    void load(controller).catch(cause => { if (!controller.signal.aborted) setError(friendlyError(cause, t)); });
    return () => { controller.abort(); requestRef.current?.abort(); requestRef.current = undefined; };
  }, [load]);

  useEffect(() => { if (!autoTakeover) autoTakeoverRef.current = false; }, [autoTakeover]);

  useEffect(() => {
    if (!autoTakeover || autoTakeoverRef.current) return;
    if (status?.state === 'ready' && watch?.url) {
      autoTakeoverRef.current = true;
      void execute('takeover');
    }
  }, [autoTakeover, status?.state, watch?.url, execute]);

  const busy = !!pending;
  const ready = status?.state === 'ready';
  const stateLabel = status ? t(`computer.state.${status.state}`) : t('computer.state.loading');

  return (
    <div className="computer-panel">
      <div className="computer-toolbar">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`live-dot ${ready ? 'live' : ''}`} />
          <span className="truncate text-sm font-medium">{t('computer.botDesktop', { name: bot.name })}</span>
          <span className="text-xs text-muted">{stateLabel}</span>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {ready ? (
            <>
              <Button size="sm" variant="ghost" className="rounded-full" isDisabled={busy} isPending={pending === 'refresh'} onPress={() => void execute('refresh')}>
                {pending === 'refresh' ? <Spinner size="sm" /> : <RefreshCw size={15} />}{t('computer.refresh')}
              </Button>
              <Button size="sm" variant="ghost" className="rounded-full" isDisabled={busy} isPending={pending === 'takeover'} onPress={() => void execute('takeover')}>
                {pending === 'takeover' ? <Spinner size="sm" /> : <Hand size={15} />}{t('computer.takeover')}
              </Button>
              <Button size="sm" variant="ghost" className="rounded-full" isDisabled={busy} isPending={pending === 'stop'} onPress={() => void execute('stop')}>
                {pending === 'stop' ? <Spinner size="sm" /> : <Square size={14} />}{t('computer.stop')}
              </Button>
            </>
          ) : (
            <Button size="sm" variant="secondary" className="rounded-full" isDisabled={busy} isPending={pending === 'start'} onPress={() => void execute('start')}>
              {pending === 'start' ? <Spinner size="sm" /> : <Play size={15} />}{t('computer.start')}
            </Button>
          )}
        </div>
      </div>
      {error && <Alert status="danger" role="alert"><Alert.Content><Alert.Description>{error}</Alert.Description></Alert.Content></Alert>}
      {status?.error && <Alert status="warning"><Alert.Content><Alert.Description>{status.error}</Alert.Description></Alert.Content></Alert>}
      {ready && (watch?.proxyUrl || watch?.url) ? (
        <iframe
          key={`${watch.proxyUrl ?? watch.url}:${frameKey}`}
          ref={frameRef}
          className="computer-frame"
          src={watch.proxyUrl ?? watch.url}
          title={t('computer.botDesktop', { name: bot.name })}
          allow="clipboard-read; clipboard-write"
        />
      ) : (
        <div className="computer-empty">
          {pending === 'start' ? <Spinner size="sm" /> : <MonitorPlay size={28} aria-hidden="true" />}
          <p>{status?.state === 'starting' ? t('computer.starting') : t('computer.stoppedHint')}</p>
          {!ready && status?.state !== 'starting' && <Button size="sm" variant="secondary" className="rounded-full" isDisabled={busy} onPress={() => void execute('start')}><Play size={15} />{t('computer.start')}</Button>}
        </div>
      )}
      {takeoverRequested && ready && <p className="text-xs text-muted" role="status">{t('computer.takeoverActive')}</p>}
    </div>
  );
}
