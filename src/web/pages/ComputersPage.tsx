import { useEffect, useState } from 'react';
import { Alert, Button, Spinner } from '@heroui/react';
import { AlertTriangle, CheckCircle2, RefreshCw, X } from 'lucide-react';
import { errorText, request } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { useLive } from '../state/LiveContext';
import { useI18n } from '../i18n';
import ToggleSwitch from '../ui/ToggleSwitch';

interface ComputerInfo {
  doctor: { dependencies: Record<string, string | null> };
  desktops: Array<{ id: string; botId: string; state: string; error?: string }>;
  bots: Array<{ id: string; name: string }>;
}

const DEPENDENCIES: Array<{ key: string; label: string; labelEn: string }> = [
  { key: 'Xvfb', label: '虚拟显示', labelEn: 'Virtual display' },
  { key: 'xfce4-session', label: 'Xfce 会话', labelEn: 'Xfce session' },
  { key: 'xfwm4', label: '窗口管理器', labelEn: 'Window manager' },
  { key: 'xfce4-panel', label: '桌面面板', labelEn: 'Desktop panel' },
  { key: 'xfdesktop', label: '桌面背景', labelEn: 'Desktop background' },
  { key: 'xauth', label: 'X 认证', labelEn: 'X authentication' },
  { key: 'xdpyinfo', label: '显示信息', labelEn: 'Display info' },
  { key: 'xprop', label: '窗口属性', labelEn: 'Window properties' },
  { key: 'xdotool', label: '输入控制', labelEn: 'Input control' },
  { key: 'xclip', label: '剪贴板', labelEn: 'Clipboard' },
  { key: 'ffmpeg', label: '录屏', labelEn: 'Screen recording' },
  { key: 'dbus-daemon', label: 'D-Bus', labelEn: 'D-Bus' },
  { key: 'voxl', label: '实时画面', labelEn: 'Live view' },
];

export default function ComputersPage() {
  const { token } = useAuth();
  const { state, busy, run } = useLive();
  const { t, locale } = useI18n();
  const [info, setInfo] = useState<ComputerInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try { setInfo(await request<ComputerInfo>(token, '/computer/doctor')); }
    catch (cause) { setError(errorText(cause)); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [token]);

  const saveAutoStart = (autoStart: boolean) => {
    void run(t('computers.saved'), () => request(token, '/computer-settings', 'PUT', { autoStart }));
  };
  const stateLabel = (value: string) => ({ ready: t('computer.state.ready'), starting: t('computer.state.starting'), stopped: t('computer.state.stopped'), error: t('computer.state.error') } as Record<string, string>)[value] ?? value;
  const missing = info ? DEPENDENCIES.filter(item => !info.doctor.dependencies[item.key]) : [];
  const missingNames = missing.map(item => locale === 'zh' ? item.label : item.labelEn).join(locale === 'zh' ? '、' : ', ');

  return <div className="flex min-w-0 flex-col gap-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><h2 className="text-2xl font-semibold tracking-tight">{t('computers.title')}</h2><p className="mt-1.5 text-sm text-muted">{t('computers.desc')}</p></div>
      <Button size="sm" variant="secondary" isPending={loading} onPress={() => void load()}><RefreshCw size={15} />{t('computers.refresh')}</Button>
    </header>

    <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-separator bg-surface px-5 py-4">
      <div className="min-w-0"><p className="text-sm font-medium">{t('computers.autoStart')}</p><p className="mt-0.5 text-xs text-muted">{t('computers.autoStartHint')}</p></div>
      <ToggleSwitch checked={state.autoStartComputers !== false} disabled={Boolean(busy)} label={t('computers.autoStart')} onChange={saveAutoStart} />
    </div>

    {loading && !info ? <div className="flex items-center gap-2 py-12 text-sm text-muted"><Spinner size="sm" />{t('computers.refresh')}</div> : error ? <Alert status="danger"><Alert.Content><Alert.Description>{error}</Alert.Description></Alert.Content></Alert> : info && <>
      {missing.length > 0 && <div className="flex items-start gap-2.5 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
        <p className="min-w-0 text-xs leading-5 text-foreground/80">{t('computers.missingList', { names: missingNames })}{missing.some(item => item.key === 'voxl') && <a className="ml-1 inline underline" href="https://github.com/tembo/voxl" target="_blank" rel="noreferrer">{t('computers.voxl')}</a>}</p>
      </div>}

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">{t('computers.components')}</h3><span className={`text-xs ${missing.length ? 'text-warning' : 'text-success'}`}>{missing.length ? t('computers.missing', { n: String(missing.length) }) : t('computers.ready')}</span></div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{DEPENDENCIES.map(item => {
          const path = info.doctor.dependencies[item.key];
          return <div key={item.key} className="flex min-w-0 items-center gap-3 rounded-xl border border-separator bg-surface px-3.5 py-3">
            <span className={path ? 'text-success' : 'text-danger'}>{path ? <CheckCircle2 size={15} /> : <X size={15} />}</span>
            <div className="min-w-0 flex-1"><p className="text-xs font-medium">{locale === 'zh' ? item.label : item.labelEn}</p><p className="truncate text-[11px] text-muted">{item.key}{path ? ` · ${path}` : ''}</p></div>
            <span className={`shrink-0 text-[11px] ${path ? 'text-success' : 'text-danger'}`}>{path ? t('computers.available') : t('computers.unavailable')}</span>
          </div>;
        })}</div>
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">{t('computers.desktops')}</h3>
        {!info.desktops.length ? <p className="rounded-xl border border-separator bg-surface px-4 py-5 text-xs text-muted">{t('computers.noDesktops')}</p> : <div className="grid gap-2 sm:grid-cols-2">{info.desktops.map(desktop => <div key={desktop.id} className="flex min-w-0 flex-col gap-1 rounded-xl border border-separator bg-surface px-4 py-3">
          <span className="truncate text-sm font-medium">{info.bots.find(bot => bot.id === desktop.botId)?.name ?? desktop.botId}</span>
          <span className="break-words text-xs text-muted">{stateLabel(desktop.state)}{desktop.error ? ` · ${desktop.error}` : ''}</span>
        </div>)}</div>}
      </section>
    </>}
  </div>;
}
