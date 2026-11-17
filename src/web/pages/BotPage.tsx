import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AlertDialog, Button, Card, Dropdown, EmptyState, Modal, Spinner } from '@heroui/react';
import { useLive, useMutate } from '../state/LiveContext';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n';
import { request, segment } from '../lib/api';
import { randomId } from '../lib/random';
import Icon from '../ui/Icon';
import IconButton from '../ui/IconButton';
import { openCreateBot } from '../ui/CreateBotDialog';
import DiscardChangesDialog from '../ui/DiscardChangesDialog';
import BotAvatar from '../ui/BotAvatar';
import useUnsavedChanges from '../ui/useUnsavedChanges';
import ChatTab from './bot/ChatTab';
import SidePanel from './bot/SidePanel';
import SettingsTab from './bot/SettingsTab';
import ComputersTab from './bot/ComputersTab';
import type { PanelKind, PanelTab, SideTab } from '../lib/types';

const PANEL_MIN = 320;
const PANEL_MAX = 900;
const PANEL_DEFAULT = 480;

function readSideWidth(): number {
  try {
    const raw = localStorage.getItem('dudu.panel.width');
    if (raw !== null) {
      const value = Number(raw);
      if (Number.isFinite(value)) return Math.max(PANEL_MIN, Math.min(PANEL_MAX, value));
    }
  } catch { /* ignore */ }
  return PANEL_DEFAULT;
}

const PANEL_STORAGE_PREFIX = 'dudu.panel.';
const PANEL_KINDS = new Set<PanelKind>(['start', 'files', 'terminal', 'session', 'computer']);
type SavedPanelState = { open: boolean; tabs: PanelTab[]; activeId: string | null };

function readPanelState(botId: string): SavedPanelState {
  const empty: SavedPanelState = { open: false, tabs: [], activeId: null };
  if (!botId) return empty;
  try {
    const raw = localStorage.getItem(`${PANEL_STORAGE_PREFIX}${botId}`);
    if (!raw) return empty;
    const value = JSON.parse(raw) as Partial<SavedPanelState>;
    const tabs: PanelTab[] = [];
    const seen = new Set<string>();
    for (const item of Array.isArray(value.tabs) ? value.tabs : []) {
      if (!item || typeof item.id !== 'string' || seen.has(item.id) || !PANEL_KINDS.has(item.kind)) continue;
      const terminalPid = typeof item.terminalPid === 'number' && Number.isSafeInteger(item.terminalPid) && item.terminalPid > 0 ? item.terminalPid : undefined;
      tabs.push({
        id: item.id,
        kind: item.kind,
        createdAt: typeof item.createdAt === 'number' && Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
        ...(item.kind === 'terminal' && terminalPid ? { terminalPid } : {}),
      });
      seen.add(item.id);
    }
    const activeId = typeof value.activeId === 'string' && tabs.some(tab => tab.id === value.activeId)
      ? value.activeId
      : tabs[0]?.id ?? null;
    return { open: value.open === true && tabs.length > 0, tabs, activeId };
  } catch {
    return empty;
  }
}

function savePanelState(botId: string, value: SavedPanelState) {
  if (!botId) return;
  try { localStorage.setItem(`${PANEL_STORAGE_PREFIX}${botId}`, JSON.stringify(value)); } catch { /* ignore */ }
}

export default function BotPage() {
  const { botId = '' } = useParams();
  const { state, loaded, busy } = useLive();
  const mutate = useMutate();
  const { token } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  // Panels and their form drafts belong to the bot that opened them.
  const [panel, setPanel] = useState<{ botId: string; tab: 'settings' | 'computers'; takeover?: boolean } | null>(null);
  const initialPanel = useRef<SavedPanelState | null>(null);
  if (!initialPanel.current) initialPanel.current = readPanelState(botId);
  const [sideOpen, setSideOpen] = useState(() => initialPanel.current!.open);
  const [panelTabs, setPanelTabs] = useState<PanelTab[]>(() => initialPanel.current!.tabs);
  const [activeTabId, setActiveTabId] = useState<string | null>(() => initialPanel.current!.activeId);
  const panelOwner = useRef(botId);
  const skipPanelPersist = useRef(false);
  const [sideWidth, setSideWidth] = useState(readSideWidth);
  const [sideResizing, setSideResizing] = useState(false);
  const closeTimer = useRef<number | undefined>(undefined);
  const rowRef = useRef<HTMLDivElement>(null);
  const [deleting, setDeleting] = useState(false);
  const [pendingAction, setPendingAction] = useState<{ botId: string; action: 'pause' | 'stop' } | null>(null);
  const bot = state.bots.find(entry => entry.id === botId);
  const status = state.statuses.find(entry => entry.botId === botId);
  const activePanel = panel?.botId === botId ? panel.tab : null;
  const advanced = state.advancedMode === true;
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const leaveDialog = useUnsavedChanges(dirty, saving);
  const openPanel = (tab: 'settings' | 'computers', takeover = false) => setPanel({ botId, tab, takeover });
  const closePanel = () => {
    if (saving) return;
    if (dirty) setConfirmClose(true);
    else setPanel(null);
  };

  const maxSideWidth = () => {
    const total = rowRef.current?.clientWidth ?? 1200;
    return Math.max(PANEL_MIN, Math.min(PANEL_MAX, total - 360));
  };
  const clampSideWidth = (value: number) => Math.max(PANEL_MIN, Math.min(maxSideWidth(), value));
  const clampDragWidth = (value: number) => Math.max(220, Math.min(maxSideWidth(), value));
  const openSide = () => {
    if (sideOpen) return;
    setSideResizing(false);
    setSideOpen(true);
  };
  const addPanelTab = (kind: PanelKind) => {
    const id = randomId();
    setPanelTabs(current => [...current, { id, kind, createdAt: Date.now() }]);
    setActiveTabId(id);
    openSide();
  };
  const openTool = (kind: SideTab) => addPanelTab(kind);
  const closePanelTab = (id: string) => {
    const index = panelTabs.findIndex(tab => tab.id === id);
    if (index < 0) return;
    const closed = panelTabs[index];
    if (closed.kind === 'terminal' && closed.terminalPid) {
      void request(token, `/bots/${segment(botId)}/terminal/kill`, 'POST', { pid: closed.terminalPid }).catch(() => {});
    }
    const next = panelTabs.filter(tab => tab.id !== id);
    setPanelTabs(next);
    if (!next.length) { closeSide(); setActiveTabId(null); return; }
    if (activeTabId === id) setActiveTabId(next[Math.min(index, next.length - 1)]!.id);
  };
  const rememberTerminalPid = (tabId: string, pid: number) => {
    setPanelTabs(current => current.map(tab => tab.id === tabId && tab.kind === 'terminal' ? { ...tab, terminalPid: pid } : tab));
  };
  const closeSide = () => {
    if (!sideOpen) return;
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    setSideResizing(false);
    setSideWidth(0);
    try { localStorage.setItem('dudu.panel.width', String(PANEL_DEFAULT)); } catch { /* ignore */ }
    closeTimer.current = window.setTimeout(() => {
      setSideOpen(false);
      setSideWidth(PANEL_DEFAULT);
      closeTimer.current = undefined;
    }, 180);
  };
  const toggleSide = () => {
    if (sideOpen) { closeSide(); return; }
    if (!panelTabs.length) { addPanelTab('start'); return; }
    openSide();
    if (!activeTabId || !panelTabs.some(tab => tab.id === activeTabId)) setActiveTabId(panelTabs[0]!.id);
  };
  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    // Freeze the effective width first. Starting a drag while the open animation
    // is still running used to snap the panel (and the chat column) to its end width.
    const effective = rowRef.current?.querySelector<HTMLElement>('.side-panel')?.getBoundingClientRect().width;
    const startWidth = effective && effective > 0 ? Math.max(220, Math.min(maxSideWidth(), effective)) : sideWidth;
    if (Math.abs(startWidth - sideWidth) > 1) setSideWidth(startWidth);
    setSideResizing(true);
    const startX = event.clientX;
    let nextWidth = startWidth;
    const move = (moveEvent: PointerEvent) => {
      nextWidth = clampDragWidth(startWidth + startX - moveEvent.clientX);
      setSideWidth(nextWidth);
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setSideResizing(false);
      if (nextWidth < PANEL_MIN) {
        setSideWidth(0);
        try { localStorage.setItem('dudu.panel.width', String(PANEL_DEFAULT)); } catch { /* ignore */ }
        if (closeTimer.current) window.clearTimeout(closeTimer.current);
        closeTimer.current = window.setTimeout(() => {
          setSideOpen(false);
          setSideWidth(PANEL_DEFAULT);
          closeTimer.current = undefined;
        }, 180);
      } else {
        try { localStorage.setItem('dudu.panel.width', String(nextWidth)); } catch { /* ignore */ }
      }
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  };
  const resizeKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const next = clampSideWidth(sideWidth + (event.key === 'ArrowLeft' ? 24 : -24));
    setSideWidth(next);
    try { localStorage.setItem('dudu.panel.width', String(next)); } catch { /* ignore */ }
  };
  const resetSideWidth = () => {
    setSideWidth(PANEL_DEFAULT);
    try { localStorage.setItem('dudu.panel.width', String(PANEL_DEFAULT)); } catch { /* ignore */ }
  };

  useEffect(() => { setSideWidth(current => clampSideWidth(current)); }, []);
  useEffect(() => {
    const onResize = () => setSideWidth(current => clampSideWidth(current));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  useEffect(() => () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
  }, []);
  useEffect(() => {
    if (panelOwner.current !== botId) {
      savePanelState(panelOwner.current, { open: sideOpen, tabs: panelTabs, activeId: activeTabId });
      panelOwner.current = botId;
      const saved = readPanelState(botId);
      skipPanelPersist.current = true;
      setSideOpen(saved.open);
      setPanelTabs(saved.tabs);
      setActiveTabId(saved.activeId);
      setSideWidth(readSideWidth());
    }
    if (closeTimer.current) { window.clearTimeout(closeTimer.current); closeTimer.current = undefined; }
    setSideResizing(false);
    setPanel(null);
    setDirty(false);
    setSaving(false);
    setConfirmClose(false);
  }, [botId]);
  useEffect(() => {
    if (skipPanelPersist.current) { skipPanelPersist.current = false; return; }
    if (panelOwner.current !== botId) return;
    savePanelState(botId, { open: sideOpen, tabs: panelTabs, activeId: activeTabId });
  }, [activeTabId, botId, panelTabs, sideOpen]);
  useEffect(() => { if (loaded && !advanced) setSideOpen(false); }, [advanced, loaded]);
  useEffect(() => {
    const target = params.get('panel');
    if (target !== 'settings' && target !== 'computers') return;
    setPanel({ botId, tab: target, takeover: params.get('takeover') === '1' });
    const next = new URLSearchParams(params); next.delete('panel'); next.delete('takeover');
    setParams(next, { replace: true });
  }, [botId, params, setParams]);

  if (!bot) {
    if (loaded) return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState>
          <h2 className="text-xl font-semibold">{t('bot.notFoundTitle')}</h2>
          <p>{t('bot.notFoundBody')}</p>
          <Button variant="secondary" onPress={() => navigate('/')}>{t('bot.back')}</Button>
        </EmptyState>
      </div>
    );
    return null;
  }

  const activeProvider = state.providers.find(provider => provider.id === (bot.provider ?? state.defaults?.provider));
  const activeModel = activeProvider?.models.find(model => model.id === (bot.model ?? state.defaults?.model));
  const context = [activeProvider?.name || activeProvider?.id, activeModel?.name || activeModel?.id].filter(Boolean).join(' · ');
  const actionPending = pendingAction?.botId === bot.id ? pendingAction.action : null;
  const actionDisabled = Boolean(busy || pendingAction);
  const performAction = async (action: 'pause' | 'stop') => {
    if (actionDisabled) return;
    const id = bot.id;
    const verb = action === 'pause' ? bot.paused ? 'resume' : 'pause' : 'stop';
    setPendingAction({ botId: id, action });
    try {
      await mutate(t(`bot.${verb}`), `/bots/${segment(id)}/${verb}`);
    } finally {
      setPendingAction(null);
    }
  };
  const deleteBot = async () => {
    const removed = await mutate(t('bot.delete'), `/bots/${segment(bot.id)}`, 'DELETE');
    if (removed) { setDeleting(false); navigate('/'); }
  };

  return (
    <>
      <div ref={rowRef} className="flex h-full min-h-0 min-w-0 flex-1 overflow-hidden">
        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
          <header className="flex h-16 min-w-0 shrink-0 items-center gap-3 border-b border-separator px-4 md:px-6">
            <BotAvatar name={bot.name} avatar={bot.avatar} color={bot.color} size="md" />
            <div className="min-w-0">
              <h1 className="truncate text-[15px] font-semibold tracking-tight" title={bot.name}>{bot.name}</h1>
              {context && <p className="truncate text-xs text-muted" title={context}>{context}</p>}
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-1">
              <IconButton label={t('ui.newChat')} onPress={openCreateBot}><Icon name="plus" size={19} /></IconButton>
              <IconButton label={t('bot.computers')} onPress={() => openPanel('computers')}><Icon name="monitor" size={19} /></IconButton>
              {advanced && <IconButton label={sideOpen ? t('panel.collapse') : t('panel.toggle')} onPress={toggleSide}><Icon name="panelRight" size={19} /></IconButton>}
              <Dropdown>
                <Button isIconOnly variant="tertiary" aria-label={t('ui.more')} aria-busy={Boolean(actionPending)}>
                  {actionPending ? <Spinner size="sm" /> : <Icon name="more" size={21} />}
                </Button>
                <Dropdown.Popover>
                  <Dropdown.Menu aria-label={t('ui.more')} disabledKeys={actionDisabled ? ['pause', 'stop'] : []} onAction={key => {
                    if (key === 'pause' || key === 'stop') void performAction(key);
                    else if (key === 'settings') openPanel('settings');
                    else if (key === 'computers') openPanel('computers');
                    else if (key === 'delete') setDeleting(true);
                  }}>
                    <Dropdown.Item id="pause" textValue={bot.paused ? t('bot.resume') : t('bot.pause')}>
                      <Icon name={bot.paused ? 'play' : 'pause'} size={17} /><span>{bot.paused ? t('bot.resume') : t('bot.pause')}</span>
                      {actionPending === 'pause' && <Spinner size="sm" />}
                    </Dropdown.Item>
                    <Dropdown.Item id="stop" textValue={t('bot.stop')}><Icon name="stop" size={16} /><span>{t('bot.stop')}</span>{actionPending === 'stop' && <Spinner size="sm" />}</Dropdown.Item>
                    <Dropdown.Item id="settings" textValue={t('bot.settings')}><Icon name="settings" size={17} /><span>{t('bot.settings')}</span></Dropdown.Item>
                    <Dropdown.Item id="computers" textValue={t('bot.computers')}><Icon name="monitor" size={17} /><span>{t('bot.computers')}</span></Dropdown.Item>
                    <Dropdown.Item id="delete" textValue={t('bot.delete')} className="text-danger"><Icon name="close" size={17} /><span>{t('bot.delete')}</span></Dropdown.Item>
                  </Dropdown.Menu>
                </Dropdown.Popover>
              </Dropdown>
            </div>
          </header>

          {(status?.error || bot.paused || status?.state === 'paused' || status?.state === 'error') && (
            <div className="mx-auto w-full max-w-4xl px-4 pb-3 md:px-6">
              <Card variant="secondary"><Card.Content><p role={status?.error || status?.state === 'error' ? 'alert' : 'status'} className="break-words text-sm">
                {status?.error || t(bot.paused || status?.state === 'paused' ? 'status.paused' : 'status.error')}
              </p></Card.Content></Card>
            </div>
          )}

          {/* Deliberately unkeyed: switching bots must not remount drafts or the input. */}
          <div className="flex min-h-0 min-w-0 flex-1">
            <ChatTab bot={bot} onOpenSettings={() => openPanel('settings')} onOpenComputers={takeover => openPanel('computers', takeover)} onOpenPanel={openTool} />
          </div>
        </div>

        {advanced && sideOpen && (
          <>
            <div
              className="side-resizer"
              role="separator"
              aria-orientation="vertical"
              aria-label={t('panel.resize')}
              aria-valuemin={220}
              aria-valuemax={maxSideWidth()}
              aria-valuenow={sideWidth}
              tabIndex={0}
              onPointerDown={startResize}
              onKeyDown={resizeKey}
              onDoubleClick={resetSideWidth}
            />
            <SidePanel
              bot={bot}
              tabs={panelTabs}
              activeId={activeTabId}
              onSelect={setActiveTabId}
              onCloseTab={closePanelTab}
              onNewTab={() => addPanelTab('start')}
              onOpenTool={openTool}
              onTerminalPid={rememberTerminalPid}
              onClose={closeSide}
              width={sideWidth}
              resizing={sideResizing}
            />
          </>
        )}
      </div>

      <Modal isOpen={Boolean(activePanel)} onOpenChange={open => { if (!open) closePanel(); }}>
        <Modal.Backdrop isDismissable={!saving}>
          <Modal.Container size="lg" className={activePanel === 'computers' ? 'computer-modal' : undefined} scroll="inside" placement="center">
            <Modal.Dialog>
              <Modal.Header><div className="flex items-center justify-between gap-3">
                <Modal.Heading>{activePanel === 'settings' ? t('bot.editTitle', { name: bot.name }) : t('bot.computers')}</Modal.Heading>
                <IconButton label={t('common.close')} isDisabled={saving} onPress={closePanel}><Icon name="close" size={19} /></IconButton>
              </div></Modal.Header>
              <Modal.Body>
                {activePanel === 'settings' && <SettingsTab key={bot.id} bot={bot} onDirtyChange={setDirty} onSavingChange={setSaving} onSaved={() => setPanel(current => current?.botId === bot.id ? null : current)} />}
                {activePanel === 'computers' && <ComputersTab key={bot.id} bot={bot} autoTakeover={Boolean(panel?.takeover)} />}
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
      <AlertDialog isOpen={deleting} onOpenChange={setDeleting}>
        <AlertDialog.Backdrop><AlertDialog.Container><AlertDialog.Dialog>
          <AlertDialog.Header><AlertDialog.Heading>{t('bot.deleteConfirm', { name: bot.name })}</AlertDialog.Heading></AlertDialog.Header>
          <AlertDialog.Body>{t('bot.deleteBody')}</AlertDialog.Body>
          <AlertDialog.Footer>
            <Button autoFocus variant="tertiary" onPress={() => setDeleting(false)}>{t('common.cancel')}</Button>
            <Button variant="danger" onPress={() => void deleteBot()}>{t('bot.delete')}</Button>
          </AlertDialog.Footer>
        </AlertDialog.Dialog></AlertDialog.Container></AlertDialog.Backdrop>
      </AlertDialog>
      <DiscardChangesDialog isOpen={confirmClose} onCancel={() => setConfirmClose(false)} onDiscard={() => { setConfirmClose(false); setDirty(false); setPanel(null); }} />
      {leaveDialog}
    </>
  );
}

export function RequireBot({ children }: { children: React.ReactNode }) {
  const { botId = '' } = useParams();
  const { state } = useLive();
  if (!state.bots.some(bot => bot.id === botId)) return <Navigate to="/" replace />;
  return <>{children}</>;
}
