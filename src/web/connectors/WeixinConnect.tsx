import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, Label, Spinner, TextField } from '@heroui/react';
import { RefreshCw } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { errorText, request, segment } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n';

type LoginState = {
  sessionKey: string;
  qrUrl: string;
  state: string;
  message: string;
  needVerifyCode?: boolean;
  verifyCode: string;
};

export default function WeixinConnect({ draft, connectorId, onBack, onConnected }: {
  draft: boolean;
  connectorId?: string;
  onBack: () => void;
  onConnected: (credentials?: Record<string, string>) => void | Promise<void>;
}) {
  const { token } = useAuth();
  const { t } = useI18n();
  const [login, setLogin] = useState<LoginState | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const polling = useRef(false);
  const completed = useRef(false);
  const started = useRef(false);

  const start = async () => {
    if (pending) return;
    setPending(true); setError(''); setLogin(null); completed.current = false;
    try {
      const endpoint = draft ? '/weixin/login/start' : `/connectors/${segment(connectorId!)}/weixin/login/start`;
      const result = await request<{ sessionKey: string; qrUrl: string }>(token, endpoint, 'POST');
      setLogin({ sessionKey: result.sessionKey, qrUrl: result.qrUrl, state: 'wait', message: t('connectors.qrWaiting'), verifyCode: '' });
    } catch (cause) { setError(errorText(cause)); }
    finally { setPending(false); }
  };

  useEffect(() => { if (started.current) return; started.current = true; void start(); }, []);

  const poll = async (current: LoginState, verifyCode?: string) => {
    if (polling.current) return;
    polling.current = true;
    try {
      const endpoint = draft ? '/weixin/login/poll' : `/connectors/${segment(connectorId!)}/weixin/login/poll`;
      const result = await request<{ state: string; message: string; needVerifyCode?: boolean; credentials?: Record<string, string> }>(token, endpoint, 'POST', { sessionKey: current.sessionKey, ...(verifyCode ? { verifyCode } : {}) });
      setLogin(value => value && value.sessionKey === current.sessionKey ? { ...value, state: result.state, message: result.message, needVerifyCode: result.needVerifyCode } : value);
      if (result.state === 'connected' && !completed.current) {
        completed.current = true;
        await onConnected(result.credentials);
      }
      if (result.state === 'expired') setLogin(value => value ? { ...value, message: t('connectors.loginExpired') } : value);
    } catch (cause) { setLogin(value => value ? { ...value, state: 'error', message: errorText(cause) } : value); }
    finally { polling.current = false; }
  };

  useEffect(() => {
    if (!login || login.needVerifyCode || ['connected', 'expired', 'error'].includes(login.state)) return;
    const timer = setInterval(() => { void poll(login); }, 2500);
    return () => clearInterval(timer);
  }, [login?.sessionKey, login?.state, login?.needVerifyCode]);

  const terminal = Boolean(login && ['expired', 'error'].includes(login.state));
  const statusText = !login ? '' : login.state === 'scaned' ? t('connectors.qrScaned') : login.state === 'connected' ? t('connectors.authSuccess') : t('connectors.qrWaiting');
  return <div className="flex flex-col items-center gap-4 py-2 text-center">
    {error && <Alert status="danger" className="w-full text-left"><Alert.Content><Alert.Description>{error}</Alert.Description></Alert.Content></Alert>}
    {pending && !login ? <div className="flex items-center gap-2 py-12 text-sm text-muted"><Spinner size="sm" />{t('connectors.qrWaiting')}</div> : login ? <>
      {terminal ? <Alert status={login.state === 'error' ? 'danger' : 'warning'} className="w-full text-left"><Alert.Content><Alert.Description>{login.message}</Alert.Description></Alert.Content></Alert> : <div className="rounded-2xl bg-white p-4"><QRCodeSVG value={login.qrUrl} size={220} /></div>}
      {!terminal && !login.needVerifyCode && <p className="text-sm" role="status" aria-live="polite">{statusText}</p>}
      {!terminal && login.needVerifyCode && <div className="flex w-full max-w-xs flex-col gap-2">
        <TextField value={login.verifyCode} onChange={value => setLogin(current => current ? { ...current, verifyCode: value } : current)}><Label>{t('connectors.verifyCode')}</Label><Input autoComplete="one-time-code" /><p className="text-xs text-muted">{t('connectors.verifyHint')}</p></TextField>
        <Button variant="secondary" onPress={() => void poll(login, login.verifyCode)}>{t('gui.save')}</Button>
      </div>}
      <div className="flex gap-2">
        <Button variant="tertiary" size="sm" onPress={onBack}>{t('connectors.backToForm')}</Button>
        <Button variant="secondary" size="sm" isDisabled={pending} onPress={() => void start()}><RefreshCw size={14} />{t('connectors.refreshQr')}</Button>
      </div>
    </> : <Button variant="secondary" size="sm" onPress={() => void start()}>{t('connectors.refreshQr')}</Button>}
  </div>;
}
