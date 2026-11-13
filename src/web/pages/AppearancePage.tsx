import { Check } from 'lucide-react';
import { useI18n } from '../i18n';
import { useThemeMode, type ThemeMode } from '../ui/theme';

const OPTIONS: { id: ThemeMode; label: 'appearance.light' | 'appearance.dark' | 'appearance.system' }[] = [
  { id: 'light', label: 'appearance.light' },
  { id: 'dark', label: 'appearance.dark' },
  { id: 'system', label: 'appearance.system' },
];

export default function AppearancePage() {
  const { t } = useI18n();
  const { mode, setMode } = useThemeMode();
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight">{t('appearance.title')}</h2>
        <p className="mt-1.5 text-sm text-muted">{t('appearance.desc')}</p>
      </header>
      <div className="theme-grid" role="radiogroup" aria-label={t('appearance.title')}>
        {OPTIONS.map(option => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={mode === option.id}
            className="theme-choice"
            data-active={mode === option.id ? 'true' : undefined}
            onClick={() => setMode(option.id)}
          >
            <span className={`theme-preview theme-preview-${option.id}`} aria-hidden="true">
              <span className="theme-preview-rail" />
              <span className="theme-preview-body"><span /><span /><span /></span>
            </span>
            <span className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{t(option.label)}</span>
              {mode === option.id && <span className="theme-check"><Check size={13} /></span>}
            </span>
          </button>
        ))}
      </div>
      <p className="text-xs text-muted">{t('appearance.systemHint')}</p>
    </div>
  );
}
