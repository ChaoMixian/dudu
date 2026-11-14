import { Alert, Button, Spinner } from '@heroui/react';
import { useI18n } from '../i18n';
import { useBuildInfo, hardReload } from '../lib/build-info';

export default function AboutPage() {
  const { t, locale } = useI18n();
  const { latest, checking, error, updateAvailable, check } = useBuildInfo();
  const commit = `${__BUILD_COMMIT__}${__BUILD_DIRTY__ ? ' + dirty' : ''}`;
  const builtAt = new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en', { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(__BUILD_TIME__));

  const row = (label: string, value: string, mono = false) => (
    <div className="flex items-center justify-between gap-4 px-5 py-4">
      <span className="shrink-0 text-sm text-muted">{label}</span>
      <span className={mono ? 'break-all text-right font-mono text-xs' : 'text-right text-sm font-medium'}>{value}</span>
    </div>
  );

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight">{t('about.title')}</h2>
        <p className="mt-1.5 text-sm text-muted">{t('about.desc')}</p>
      </header>

      <section className="overflow-hidden rounded-2xl border border-separator bg-surface" aria-label={t('about.title')}>
        {row(t('about.version'), __APP_VERSION__)}
        <div className="border-t border-separator">{row(t('about.build'), __BUILD_ID__, true)}</div>
        <div className="border-t border-separator">{row(t('about.commit'), commit, true)}</div>
        <div className="border-t border-separator">{row(t('about.builtAt'), builtAt)}</div>
      </section>

      {error && <Alert status="warning"><Alert.Content><Alert.Description>{t('about.unavailable')}</Alert.Description></Alert.Content></Alert>}
      {!latest && !error && <div className="flex items-center gap-2 text-sm text-muted"><Spinner size="sm" />{t('about.checking')}</div>}
      {updateAvailable && (
        <Alert status="warning">
          <Alert.Content>
            <Alert.Title>{t('about.updateAvailable', { build: latest?.build ?? '' })}</Alert.Title>
            <Alert.Description>{t('about.cacheHint')}</Alert.Description>
          </Alert.Content>
        </Alert>
      )}
      {latest && !updateAvailable && <p className="text-sm text-muted">{t('about.upToDate')}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" className="rounded-full" isPending={checking} onPress={() => void check()}>{checking ? t('about.checking') : t('about.check')}</Button>
        <Button variant="ghost" className="rounded-full" onPress={hardReload}>{t('about.reload')}</Button>
      </div>
    </div>
  );
}
