import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Alert, AlertDialog, Button, Dropdown, Input, Modal, Spinner, TextField, Tooltip } from '@heroui/react';
import type { BotConfig } from '../../contracts';
import { request, segment } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { useLive } from '../state/LiveContext';
import { useI18n } from '../i18n';
import { hardReload, useBuildInfo } from '../lib/build-info';
import BotAvatar from './BotAvatar';
import BrandMark from './BrandMark';
import Icon, { type IconName } from './Icon';
import IconButton from './IconButton';
import CreateBotDialog, { CREATE_BOT_EVENT } from './CreateBotDialog';

function readPins(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem('dudu.pinned-bots') ?? '[]');
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch { return []; }
}

export default function AppShell() {
  const { state, loaded, liveError, live, refresh, toasts, run } = useLive();
  const { updateAvailable, latest } = useBuildInfo();
  const { authRequired, logout, token } = useAuth();
  const { t, locale, setLocale } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 768px)').matches);
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try { return localStorage.getItem('dudu.sidebar') !== 'collapsed'; } catch { return true; }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [pins, setPins] = useState(readPins);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState('');
  const [deletingBot, setDeletingBot] = useState<BotConfig | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const activeBot = /^\/bots\/([^/]+)/.exec(location.pathname)?.[1];
  const profile = state.profile ?? {};
  const displayName = profile.name?.trim() || t('profile.defaultName');
  const profileInitial = Array.from(displayName)[0]?.toUpperCase() ?? '?';
  const normalizedQuery = query.trim().toLocaleLowerCase();

  const lastMessage = (botId: string, matchQuery = false) => {
    const messages = state.messages
      .filter(message => message.botId === botId && message.conversationId === 'default' && message.kind !== 'reaction')
      .sort((a, b) => a.seq - b.seq);
    if (!matchQuery || !normalizedQuery) return messages.at(-1);
    return [...messages].reverse().find(message => message.text.toLocaleLowerCase().includes(normalizedQuery)) ?? messages.at(-1);
  };
  const bots = state.bots.filter(bot => !normalizedQuery
    || `${bot.name} ${bot.description ?? ''} ${bot.id} ${lastMessage(bot.id, true)?.text ?? ''}`.toLocaleLowerCase().includes(normalizedQuery));
  const pinned = bots.filter(bot => pins.includes(bot.id));
  const unpinned = bots.filter(bot => !pins.includes(bot.id));
  const railBots = [...state.bots].sort((a, b) => Number(pins.includes(b.id)) - Number(pins.includes(a.id)));

  useEffect(() => {
    const open = () => setCreating(true);
    window.addEventListener(CREATE_BOT_EVENT, open);
    return () => window.removeEventListener(CREATE_BOT_EVENT, open);
  }, []);
  useEffect(() => { if (searching) searchRef.current?.focus(); }, [searching, mobileOpen]);
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);
  useEffect(() => {
    try { localStorage.setItem('dudu.sidebar', sidebarOpen ? 'open' : 'collapsed'); } catch { /* Keep session-only state when storage is unavailable. */ }
  }, [sidebarOpen]);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 768px)');
    const sync = () => { setMobile(media.matches); setMobileOpen(false); };
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSidebarOpen(true);
        setMobileOpen(true);
        setSearching(true);
        requestAnimationFrame(() => searchRef.current?.focus());
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        setCreating(true);
      }
      if (event.key === 'Escape' && searching) { setSearching(false); setQuery(''); }
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, [searching]);

  const refreshState = async () => {
    if (refreshing) return;
    setRefreshing(true); setRefreshError('');
    try { await refresh(); } catch (error) { setRefreshError(error instanceof Error ? error.message : String(error)); }
    finally { setRefreshing(false); }
  };
  const togglePin = (id: string) => {
    setPins(current => {
      const next = current.includes(id) ? current.filter(pin => pin !== id) : [...current, id];
      try { localStorage.setItem('dudu.pinned-bots', JSON.stringify(next)); } catch { /* Keep session-only preferences when storage is unavailable. */ }
      return next;
    });
  };
  const botAction = async (bot: BotConfig, action: 'pause' | 'resume' | 'stop') => {
    await run(t(`bot.${action}`), () => request(token, `/bots/${segment(bot.id)}/${action}`, 'POST'));
  };
  const deleteBot = async () => {
    if (!deletingBot) return;
    const target = deletingBot;
    const removed = await run(t('bot.delete'), () => request(token, `/bots/${segment(target.id)}`, 'DELETE'));
    if (removed) {
      setDeletingBot(null);
      if (activeBot === target.id) navigate('/');
    }
  };

  const searchField = searching && (
    <TextField value={query} onChange={setQuery} aria-label={t('ui.search')}>
      <Input ref={searchRef} className="rounded-xl" placeholder={t('ui.searchBots')} />
    </TextField>
  );

  const botRow = (bot: typeof bots[number]) => {
    const message = lastMessage(bot.id, Boolean(normalizedQuery));
    const preview = (message?.text || message?.attachments?.map(attachment => attachment.name).join(', ')) ?? bot.description ?? t('ui.startChat', { name: bot.name });
    return (
      <div className="bot-row-wrap" key={bot.id}>
        <button type="button" className="bot-row" data-active={activeBot === bot.id ? 'true' : undefined} onClick={() => navigate(`/bots/${bot.id}`)} aria-current={activeBot === bot.id ? 'page' : undefined}>
          <BotAvatar name={bot.name} avatar={bot.avatar} color={bot.color} />
          <span className="bot-row-copy">
            <span className="bot-row-name">{bot.name}</span>
            <span className="bot-row-preview">{preview}</span>
          </span>
        </button>
        <Dropdown>
          <Button isIconOnly size="sm" variant="ghost" className="bot-row-more" aria-label={`${t('ui.more')} ${bot.name}`}><Icon name="more" size={16} /></Button>
          <Dropdown.Popover placement="bottom end"><Dropdown.Menu aria-label={bot.name} onAction={key => {
            if (key === 'pin') togglePin(bot.id);
            else if (key === 'pause') void botAction(bot, bot.paused ? 'resume' : 'pause');
            else if (key === 'stop') void botAction(bot, 'stop');
            else if (key === 'settings') navigate(`/bots/${bot.id}?panel=settings`);
            else if (key === 'computers') navigate(`/bots/${bot.id}?panel=computers`);
            else if (key === 'delete') setDeletingBot(bot);
          }}>
            <Dropdown.Item id="pin" textValue={t(pins.includes(bot.id) ? 'ui.unpin' : 'ui.pin')}><Icon name="pin" size={16} />{t(pins.includes(bot.id) ? 'ui.unpin' : 'ui.pin')}</Dropdown.Item>
            <Dropdown.Item id="pause" textValue={t(bot.paused ? 'bot.resume' : 'bot.pause')}><Icon name={bot.paused ? 'play' : 'pause'} size={16} />{t(bot.paused ? 'bot.resume' : 'bot.pause')}</Dropdown.Item>
            <Dropdown.Item id="stop" textValue={t('bot.stop')}><Icon name="stop" size={15} />{t('bot.stop')}</Dropdown.Item>
            <Dropdown.Item id="settings" textValue={t('bot.settings')}><Icon name="settings" size={16} />{t('bot.settings')}</Dropdown.Item>
            <Dropdown.Item id="computers" textValue={t('bot.computers')}><Icon name="monitor" size={16} />{t('bot.computers')}</Dropdown.Item>
            <Dropdown.Item id="delete" textValue={t('bot.delete')} className="text-danger"><Icon name="close" size={16} />{t('bot.delete')}</Dropdown.Item>
          </Dropdown.Menu></Dropdown.Popover>
        </Dropdown>
      </div>
    );
  };

  const sidebar = (closeButton: ReactNode) => (
    <div className="panel-shell">
      <header className="panel-head">
        <button type="button" className="panel-brand" onClick={() => navigate('/')} aria-label={t('nav.overview')}>
          <BrandMark />
          <span>dudu</span>
        </button>
        <div className="flex items-center gap-0.5">
          <IconButton label={t('ui.search')} onPress={() => setSearching(value => !value)}><Icon name="search" /></IconButton>
          {closeButton}
        </div>
      </header>
      {searchField && <div className="px-4 pb-2">{searchField}</div>}
      <div className="panel-scroll">
        <nav className="panel-nav" aria-label={t('common.actions')}>
          <button type="button" className="side-nav-item" onClick={() => setCreating(true)}>
            <Icon name="edit" size={19} /><span>{t('ui.newChat')}</span>
          </button>
        </nav>
        <section className="panel-section" aria-label={t('ui.bots')}>
          <div className="section-head">
            <span>{t('ui.bots')}</span>
            <button type="button" className="section-add" onClick={() => setCreating(true)} aria-label={t('ui.newChat')}><Icon name="plus" size={17} /></button>
          </div>
          {pinned.length > 0 && <><p className="section-label">{t('ui.pinned')}</p>{pinned.map(botRow)}</>}
          {unpinned.length > 0 && pinned.length > 0 && <p className="section-label">{t('ui2.otherBots')}</p>}
          {unpinned.map(botRow)}
          {!bots.length && <p className="px-2 py-3 text-sm text-muted">{t(normalizedQuery ? 'ui.noResults' : 'ui.noBots')}</p>}
        </section>
      </div>
      <nav className="panel-nav panel-footer-nav" aria-label={t('common.actions')}>
        <button type="button" className="side-nav-item" data-active={location.pathname.startsWith('/automations') ? 'true' : undefined} aria-current={location.pathname.startsWith('/automations') ? 'page' : undefined} onClick={() => navigate('/automations')}>
          <Icon name="clock" size={19} /><span>{t('ui.automations')}</span>
        </button>
        <button type="button" className="side-nav-item" data-active={location.pathname.startsWith('/settings') ? 'true' : undefined} aria-current={location.pathname.startsWith('/settings') ? 'page' : undefined} onClick={() => navigate('/settings/profile')}>
          <Icon name="settings" size={19} /><span>{t('nav.settings')}</span>
        </button>
      </nav>
      <div className="panel-bottom">
        <Dropdown>
          <Button variant="ghost" className="profile-card" aria-label={t('profile.menu')}>
            <span className="profile-avatar" aria-hidden="true">
              {profile.avatar ? <img className="profile-avatar-image" src={profile.avatar} alt="" /> : profileInitial}
            </span>
            <span className="profile-copy">
              <span className="profile-title" title={displayName}>{displayName}</span>
              <span className="profile-meta"><span className={`live-dot ${live}`} />{live === 'live' ? t('status.live') : live === 'connecting' ? t('status.connecting') : t('status.reconnecting')}</span>
            </span>
            <Icon name="chevron" size={15} className="-rotate-90 text-muted" />
          </Button>
          <Dropdown.Popover placement="top start"><Dropdown.Menu aria-label={t('profile.menu')} onAction={key => {
            if (key === 'profile') navigate('/settings/profile');
            if (key === 'appearance') navigate('/settings/appearance');
            if (key === 'language') setLocale(locale === 'zh' ? 'en' : 'zh');
            if (key === 'refresh') void refreshState();
            if (key === 'logout') logout();
          }}>
            <Dropdown.Item id="profile" textValue={t('profile.title')}><Icon name="user" size={17} />{t('profile.title')}</Dropdown.Item>
            <Dropdown.Item id="appearance" textValue={t('nav.appearance')}><Icon name="sun" size={17} />{t('nav.appearance')}</Dropdown.Item>
            <Dropdown.Item id="language" textValue={t('nav.language')}><Icon name="globe" size={17} />{locale === 'zh' ? 'English' : '简体中文'}</Dropdown.Item>
            <Dropdown.Item id="refresh" isDisabled={refreshing} textValue={t('status.refresh')}><Icon name="refresh" size={17} />{t('status.refresh')}</Dropdown.Item>
            {authRequired ? <Dropdown.Item id="logout" textValue={t('auth.logout')}><Icon name="logout" size={17} />{t('auth.logout')}</Dropdown.Item> : null}
          </Dropdown.Menu></Dropdown.Popover>
        </Dropdown>
      </div>
    </div>
  );

  const railButton = (label: string, content: ReactNode, active: boolean, action: () => void, className = '') => (
    <Tooltip delay={300}>
      <button type="button" className={`rail-item ${className}`.trim()} data-active={active ? 'true' : undefined} aria-label={label} aria-current={active ? 'page' : undefined} onClick={action}>
        {content}
      </button>
      <Tooltip.Content>{label}</Tooltip.Content>
    </Tooltip>
  );

  const railItem = (label: string, icon: IconName, active: boolean, action: () => void) =>
    railButton(label, <Icon name={icon} size={20} />, active, action);

  return (
    <div className="app-shell">
      {!mobile && (
        <aside className="app-sidebar" data-collapsed={sidebarOpen ? undefined : 'true'} aria-label={t('app.name')}>
          {sidebarOpen ? <div className="app-panel-inner">{sidebar(<IconButton label={t('ui.closeSidebar')} onPress={() => setSidebarOpen(false)}><Icon name="sidebar" /></IconButton>)}</div> : (
            <div className="app-rail">
              {railItem(t('ui.openSidebar'), 'sidebar', false, () => setSidebarOpen(true))}
              {railButton(t('nav.overview'), <BrandMark />, location.pathname === '/', () => navigate('/'))}
              <span className="rail-divider" aria-hidden="true" />
              <div className="rail-bots" role="list" aria-label={t('ui.bots')}>
                {railBots.map(bot => railButton(
                  bot.name,
                  <BotAvatar name={bot.name} avatar={bot.avatar} color={bot.color} size="md" />,
                  activeBot === bot.id,
                  () => navigate(`/bots/${bot.id}`),
                  'rail-bot-item',
                ))}
                {railButton(t('ui.newChat'), <span className="rail-add"><Icon name="plus" size={18} /></span>, false, () => setCreating(true), 'rail-bot-item')}
              </div>
              <span className="rail-divider" aria-hidden="true" />
              {railItem(t('ui.automations'), 'clock', location.pathname.startsWith('/automations'), () => navigate('/automations'))}
              {railItem(t('nav.connectors'), 'plug', location.pathname === '/settings/connectors', () => navigate('/settings/connectors'))}
              {railItem(t('nav.settings'), 'settings', location.pathname.startsWith('/settings') && location.pathname !== '/settings/connectors', () => navigate('/settings/profile'))}
            </div>
          )}
        </aside>
      )}

      {mobile && <Modal isOpen={mobileOpen} onOpenChange={setMobileOpen}>
        <Modal.Backdrop><Modal.Container size="sm" scroll="inside" placement="center"><Modal.Dialog aria-label={t('app.name')}>
          <Modal.Body className="p-0">{sidebar(<IconButton label={t('common.close')} onPress={() => setMobileOpen(false)}><Icon name="close" /></IconButton>)}</Modal.Body>
        </Modal.Dialog></Modal.Container></Modal.Backdrop>
      </Modal>}

      <main className="app-main">
        {mobile && <div className="mobile-topbar">
          <IconButton label={t('ui.openSidebar')} onPress={() => setMobileOpen(true)}><Icon name="sidebar" /></IconButton>
          <BrandMark size={20} />
          <span className="mobile-brand">dudu</span>
        </div>}
        {updateAvailable && <div className="build-update-banner" role="status">
          <span>{t('about.updateAvailable', { build: latest?.build ?? '' })}</span>
          <Button size="sm" variant="secondary" className="rounded-full" onPress={hardReload}>{t('about.reload')}</Button>
        </div>}
        {(liveError || refreshError) && <div className="px-4 pt-3"><Alert status="warning"><Alert.Content><Alert.Description>{refreshError || t('status.liveUnavailable')}</Alert.Description></Alert.Content><Button size="sm" variant="ghost" isPending={refreshing} onPress={() => void refreshState()}>{t('status.refresh')}</Button></Alert></div>}
        <div className="app-content">{loaded ? <Outlet /> : <div className="flex h-full items-center justify-center"><Spinner size="sm" /></div>}</div>
      </main>

      <CreateBotDialog isOpen={creating} onOpenChange={setCreating} />

      <AlertDialog isOpen={!!deletingBot} onOpenChange={open => { if (!open) setDeletingBot(null); }}>
        <AlertDialog.Backdrop><AlertDialog.Container><AlertDialog.Dialog>
          <AlertDialog.Header><AlertDialog.Heading>{t('bot.deleteConfirm', { name: deletingBot?.name ?? '' })}</AlertDialog.Heading></AlertDialog.Header>
          <AlertDialog.Body>{t('bot.deleteBody')}</AlertDialog.Body>
          <AlertDialog.Footer>
            <Button autoFocus variant="tertiary" onPress={() => setDeletingBot(null)}>{t('common.cancel')}</Button>
            <Button variant="danger" onPress={() => void deleteBot()}>{t('bot.delete')}</Button>
          </AlertDialog.Footer>
        </AlertDialog.Dialog></AlertDialog.Container></AlertDialog.Backdrop>
      </AlertDialog>

      <div className="toast-stack" role="region" aria-label={t('common.actions')}>
        {toasts.filter(toast => toast.kind === 'error').map(toast => <Alert key={toast.id} status="danger"><Alert.Content><Alert.Description>{toast.text}</Alert.Description></Alert.Content></Alert>)}
      </div>
    </div>
  );
}
