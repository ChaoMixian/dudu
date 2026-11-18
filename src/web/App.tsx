import { Navigate, Outlet, Route, Routes, useNavigate } from 'react-router-dom';
import { Alert, Button, Spinner } from '@heroui/react';
import { useAuth } from './auth/AuthContext';
import { LiveProvider, useLive } from './state/LiveContext';
import AppShell from './ui/AppShell';
import LoginPage from './pages/LoginPage';
import SetupPage from './pages/SetupPage';
import BotPage from './pages/BotPage';
import SettingsPage from './pages/SettingsPage';
import AutomationsPage from './pages/AutomationsPage';
import { useI18n } from './i18n';
import { useKeyboardViewport } from './lib/viewport';
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

function AuthUnavailable() {
  const { authError, retry } = useAuth();
  const { t } = useI18n();
  return (
    <div className="login-page">
      <section className="login-panel" aria-label={t('app.name')}>
        <header className="login-brand">
          <BrandMark size={40} />
          <h1>dudu</h1>
        </header>
        <div className="login-alerts">
          <Alert status="warning">
            <Alert.Content>
              <Alert.Title>{t('auth.unreachable')}</Alert.Title>
              <Alert.Description>{authError}</Alert.Description>
            </Alert.Content>
          </Alert>
        </div>
        <Button type="button" variant="primary" className="w-full" onPress={retry}>{t('auth.retry')}</Button>
      </section>
    </div>
  );
}

function Guard() {
  const { authenticated, authRequired, authError } = useAuth();
  if (authError) return <AuthUnavailable />;
  if (authenticated === null && authRequired !== false) return null;
  if (!authenticated) return <LoginPage />;
  return <LiveProvider><Outlet /></LiveProvider>;
}

function SetupLoading() {
  return <div className="setup-page"><div className="setup-shell setup-loading"><Spinner size="lg" /></div></div>;
}

function SetupRoute() {
  const { loaded, state } = useLive();
  if (!loaded) return <SetupLoading />;
  if (state.setupCompleted) {
    const bot = state.bots.at(-1);
    return <Navigate to={bot ? `/bots/${bot.id}` : '/'} replace />;
  }
  return <SetupPage />;
}

function ShellRoute() {
  const { loaded, state } = useLive();
  if (loaded && !state.setupCompleted) return <Navigate to="/setup" replace />;
  return <AppShell />;
}

export default function App() {
  useKeyboardViewport();
  return (
    <Routes>
      <Route element={<Guard />}>
        <Route path="/setup" element={<SetupRoute />} />
        <Route element={<ShellRoute />}>
          <Route path="/" element={<Welcome />} />
          <Route path="/bots/:botId" element={<BotPage />} />
          <Route path="/settings" element={<Navigate to="/settings/profile" replace />} />
          <Route path="/settings/:tab" element={<SettingsPage />} />
          <Route path="/automations" element={<AutomationsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Route>
    </Routes>
  );
}
