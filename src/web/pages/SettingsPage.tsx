import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Info, Plug, Server, Sun } from 'lucide-react';
import { useI18n } from '../i18n';
import useUnsavedChanges from '../ui/useUnsavedChanges';
import AboutPage from './AboutPage';
import AppearancePage from './AppearancePage';
import ConnectorsPage from './ConnectorsPage';
import ProvidersPage from './ProvidersPage';

export default function SettingsPage() {
  const { tab = 'providers' } = useParams();
  if (!['providers', 'connectors', 'appearance', 'about'].includes(tab)) return <Navigate to="/settings/providers" replace />;
  return <SettingsContent key={tab} tab={tab} />;
}

function SettingsContent({ tab }: { tab: string }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const leaveDialog = useUnsavedChanges(dirty, pending);
  const go = (next: string) => { if (!pending) navigate(`/settings/${next}`); };
  return (
    <div className="page-scroll">
      <div className="mx-auto w-full max-w-[1180px] px-5 py-6 md:px-8 md:py-10">
        <div className="flex flex-col gap-6 lg:flex-row lg:gap-12">
          <aside className="lg:w-52 lg:shrink-0">
            <h1 className="px-3 text-xl font-semibold tracking-tight">{t('nav.settings')}</h1>
            <nav className="mt-5 flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible" aria-label={t('nav.settings')}>
              <button type="button" className="settings-link" data-active={tab === 'providers' ? 'true' : undefined} aria-current={tab === 'providers' ? 'page' : undefined} onClick={() => go('providers')} disabled={pending}>
                <Server size={17} aria-hidden="true" /><span>{t('nav.providers')}</span>
              </button>
              <button type="button" className="settings-link" data-active={tab === 'connectors' ? 'true' : undefined} aria-current={tab === 'connectors' ? 'page' : undefined} onClick={() => go('connectors')} disabled={pending}>
                <Plug size={17} aria-hidden="true" /><span>{t('nav.connectors')}</span>
              </button>
              <button type="button" className="settings-link" data-active={tab === 'appearance' ? 'true' : undefined} aria-current={tab === 'appearance' ? 'page' : undefined} onClick={() => go('appearance')} disabled={pending}>
                <Sun size={17} aria-hidden="true" /><span>{t('appearance.title')}</span>
              </button>
              <button type="button" className="settings-link" data-active={tab === 'about' ? 'true' : undefined} aria-current={tab === 'about' ? 'page' : undefined} onClick={() => go('about')} disabled={pending}>
                <Info size={17} aria-hidden="true" /><span>{t('about.title')}</span>
              </button>
            </nav>
          </aside>
          <div className="min-w-0 flex-1">
            {tab === 'providers' && <ProvidersPage onDirtyChange={setDirty} onPendingChange={setPending} />}
            {tab === 'connectors' && <ConnectorsPage onDirtyChange={setDirty} onPendingChange={setPending} />}
            {tab === 'appearance' && <AppearancePage />}
            {tab === 'about' && <AboutPage />}
          </div>
        </div>
      </div>
      {leaveDialog}
    </div>
  );
}
