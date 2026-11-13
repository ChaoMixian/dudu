import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { LiveProvider, useLive } from './state/LiveContext';
import AppShell from './ui/AppShell';
import LoginPage from './pages/LoginPage';
import BotPage from './pages/BotPage';
import SettingsPage from './pages/SettingsPage';
import AutomationsPage from './pages/AutomationsPage';
import { useI18n } from './i18n';
import Icon from './ui/Icon';
import BotAvatar from './ui/BotAvatar';
import BrandMark from './ui/BrandMark';
import { openCreateBot } from './ui/CreateBotDialog';

function Welcome() {
  const { state } = useLive();
  const { t } = useI18n();
  const navigate = useNavigate();
  return (
    <div className="page-scroll">
      <div className="flex min-h-full items-center justify-center px-6 py-16">
        <div className="w-full max-w-3xl">
          <div className="flex flex-col items-center text-center">
            <BrandMark size={56} />
            <h1 className="mt-6 text-[28px] font-semibold tracking-tight">{t('ui.welcome')}</h1>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-muted">{t('ui2.welcomeNote')}</p>
          </div>
          <div className="mt-9 grid gap-2.5 sm:grid-cols-2">
            {state.bots.map(bot => (
              <button type="button" key={bot.id} className="bot-card" onClick={() => navigate(`/bots/${bot.id}`)}>
                <BotAvatar name={bot.name} avatar={bot.avatar} color={bot.color} size="md" />
                <span className="bot-card-copy">
                  <span className="bot-card-name">{bot.name}</span>
                  <span className="bot-card-desc">{bot.description || t('ui.startChat', { name: bot.name })}</span>
                </span>
                <Icon name="chevron" size={16} className="bot-card-chevron" />
              </button>
            ))}
            <button type="button" className="new-bot-card" onClick={openCreateBot}>
              <span className="new-bot-icon"><Icon name="plus" size={18} /></span>
              <span>{t('overview.createBot')}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Guard({ children }: { children: React.ReactNode }) {
  const { authenticated, authRequired } = useAuth();
  if (authenticated === null && authRequired !== false) return null;
  if (!authenticated) return <LoginPage />;
  return <LiveProvider>{children}</LiveProvider>;
}

export default function App() {
  return (
    <Routes>
      <Route element={<Guard><AppShell /></Guard>}>
        <Route path="/" element={<Welcome />} />
        <Route path="/bots/new" element={<Navigate to="/" replace />} />
        <Route path="/bots/:botId" element={<BotPage />} />
        <Route path="/settings" element={<Navigate to="/settings/providers" replace />} />
        <Route path="/settings/:tab" element={<SettingsPage />} />
        <Route path="/automations" element={<AutomationsPage />} />
        <Route path="/connectors" element={<Navigate to="/settings/connectors" replace />} />
        <Route path="/sources" element={<Navigate to="/automations" replace />} />
        <Route path="/providers" element={<Navigate to="/settings/providers" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
