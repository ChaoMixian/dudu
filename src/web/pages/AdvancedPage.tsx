import { useAuth } from '../auth/AuthContext';
import { useLive } from '../state/LiveContext';
import { useI18n } from '../i18n';
import { saveAdvancedMode } from '../lib/api';
import ToggleSwitch from '../ui/ToggleSwitch';

export default function AdvancedPage() {
  const { token } = useAuth();
  const { state, run, busy } = useLive();
  const { t } = useI18n();
  const enabled = state.advancedMode === true;
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight">{t('advanced.title')}</h2>
        <p className="mt-1.5 text-sm text-muted">{t('advanced.desc')}</p>
      </header>
      <section className="flex flex-col gap-3 rounded-2xl border border-separator bg-surface px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{t('advanced.enable')}</h3>
          <p className="mt-0.5 text-xs text-muted">{t('advanced.hint')}</p>
        </div>
        <ToggleSwitch checked={enabled} disabled={Boolean(busy)} label={t('advanced.toggle')} onChange={value => void run(t('advanced.saved'), () => saveAdvancedMode(token, value))} />
      </section>
      <p className="text-xs text-muted">{t('advanced.note')}</p>
    </div>
  );
}
