import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Spinner } from '@heroui/react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { errorText, request, segment } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n';
import IconButton from '../ui/IconButton';

type LoginState = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  interval: number;
  state: string;
  message: string;
};

export default function OutlookConnect({ draft, connectorId, settings, onBack, onConnected }: {
  draft: boolean;
  connectorId?: string;
  settings: Record<string, unknown>;
  onBack: () => void;
  onConnected: (credentials?: Record<string, string>) => void | Promise<void>;
}) {
  const { token } = useAuth();
  const { t } = useI18n();
  const [login, setLogin] = useState<LoginState | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const completed = useRef(false);
  const started = useRef(false);
  const friendlyError = (message: string) => message.includes('AADSTS70002') ? t('connectors.outlookPublicClientError') : message;

  const start = async () => {
    if (pending) return;
    setPending(true); setError(''); setLogin(null); setCopied(false); completed.current = false;
    try {
      const endpoint = draft ? '/outlook/device/start' : `/connectors/${segment(connectorId!)}/outlook/device/start`;
      const result = await request<{ deviceCode: string; userCode: string; verificationUri: string; interval: number }>(token, endpoint, 'POST', draft ? { settings } : undefined);
      setLogin({ deviceCode: result.deviceCode, userCode: result.userCode, verificationUri: result.verificationUri, interval: Math.max(2, result.interval), state: 'wait', message: t('connectors.outlookWaiting') });
    } catch (cause) { setError(friendlyError(errorText(cause))); }
    finally { setPending(false); }
  };

  useEffect(() => { if (started.current) return; started.current = true; void start(); }, []);

  useEffect(() => {
    if (!login || ['connected', 'expired', 'declined', 'error'].includes(login.state)) return;
    const timer = setInterval(async () => {
      try {
        const endpoint = draft ? '/outlook/device/poll' : `/connectors/${segment(connectorId!)}/outlook/device/poll`;
        const body = draft ? { deviceCode: login.deviceCode, settings } : { deviceCode: login.deviceCode };
        const result = await request<{ status: string; message: string; credentials?: Record<string, string> }>(token, endpoint, 'POST', body);
        setLogin(current => current ? { ...current, state: result.status, message: result.message } : current);
        if (result.status === 'connected' && !completed.current) {
          completed.current = true;
          await onConnected(result.credentials);
        }
      } catch (cause) { setLogin(current => current ? { ...current, state: 'error', message: friendlyError(errorText(cause)) } : current); }
    }, Math.max(2, login.interval) * 1000);
    return () => clearInterval(timer);
  }, [login?.deviceCode, login?.state]);

  const copy = async () => {
    if (!login) return;
    let copied = false;
    try { await navigator.clipboard.writeText(login.userCode); copied = true; } catch { /* insecure contexts and denied permissions */ }
    if (!copied) {
      try {
        const field = document.createElement('textarea');
        field.value = login.userCode;
        field.style.position = 'fixed';
        field.style.opacity = '0';
        document.body.appendChild(field);
        field.select();
        copied = document.execCommand('copy');
        field.remove();
      } catch { /* fall through to the error message */ }
    }
    if (copied) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } else setError(t('connectors.outlookCopyFailed'));
  };

  const terminal = login ? ['expired', 'declined', 'error'].includes(login.state) : false;
  const statusText = !login ? '' : login.state === 'slow_down' ? t('connectors.outlookSlowDown') : login.state === 'expired' ? t('connectors.outlookExpired') : login.state === 'declined' ? t('connectors.outlookDeclined') : login.state === 'error' ? login.message : login.state === 'connected' ? t('connectors.authSuccess') : t('connectors.outlookWaiting');

  return <div className="flex flex-col items-center gap-4 py-2 text-center">
    {error && <Alert status="danger" className="w-full text-left"><Alert.Content><Alert.Description>{error}</Alert.Description></Alert.Content></Alert>}
    {pending && !login ? <div className="flex items-center gap-2 py-12 text-sm text-muted"><Spinner size="sm" />{t('connectors.outlookWaiting')}</div> : login ? <>
      {terminal ? <Alert status={login.state === 'error' ? 'danger' : 'warning'} className="w-full text-left"><Alert.Content><Alert.Description>{statusText}</Alert.Description></Alert.Content></Alert> : <>
        <p className="text-sm text-muted">{t('connectors.outlookCode')}</p>
        <div className="flex items-center gap-2 rounded-xl border border-separator bg-background/40 px-4 py-2.5">
          <span className="font-mono text-2xl font-semibold tracking-[0.2em]">{login.userCode}</span>
          <IconButton label={copied ? t('connectors.outlookCopied') : t('connectors.outlookCopyCode')} onPress={() => void copy()}>{copied ? <Check size={16} className="text-success" /> : <Copy size={16} />}</IconButton>
        </div>
        <Button variant="secondary" onPress={() => window.open(login.verificationUri, '_blank', 'noopener,noreferrer')}><ExternalLink size={15} />{t('connectors.outlookOpen')}</Button>
        <p className="text-xs text-muted" role="status" aria-live="polite">{statusText}</p>
      </>}
      <div className="flex gap-2">
        <Button variant="tertiary" size="sm" onPress={onBack}>{t('connectors.backToForm')}</Button>
        <Button variant="secondary" size="sm" isDisabled={pending} onPress={() => void start()}>{t('connectors.outlookRestart')}</Button>
      </div>
    </> : <Button variant="secondary" size="sm" onPress={() => void start()}>{t('connectors.outlookRestart')}</Button>}
  </div>;
}
