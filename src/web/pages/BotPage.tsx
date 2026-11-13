import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AlertDialog, Button, Card, Dropdown, EmptyState, Modal, Spinner } from '@heroui/react';
import { useLive, useMutate } from '../state/LiveContext';
import { useI18n } from '../i18n';
import { segment } from '../lib/api';
import Icon from '../ui/Icon';
import IconButton from '../ui/IconButton';
import DiscardChangesDialog from '../ui/DiscardChangesDialog';
import BotAvatar from '../ui/BotAvatar';
import useUnsavedChanges from '../ui/useUnsavedChanges';
import ChatTab from './bot/ChatTab';
import SettingsTab from './bot/SettingsTab';
import ComputersTab from './bot/ComputersTab';

export default function BotPage() {
  const { botId = '' } = useParams();
  const { state, loaded, busy } = useLive();
  const mutate = useMutate();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  // Panels and their form drafts belong to the bot that opened them.
  const [panel, setPanel] = useState<{ botId: string; tab: 'settings' | 'computers'; takeover?: boolean } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [pendingAction, setPendingAction] = useState<{ botId: string; action: 'pause' | 'stop' } | null>(null);
  const bot = state.bots.find(entry => entry.id === botId);
  const status = state.statuses.find(entry => entry.botId === botId);
  const activePanel = panel?.botId === botId ? panel.tab : null;
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
  useEffect(() => { setPanel(null); setDirty(false); setSaving(false); setConfirmClose(false); }, [botId]);
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
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex h-16 min-w-0 shrink-0 items-center gap-3 border-b border-separator px-4 md:px-6">
        <BotAvatar name={bot.name} avatar={bot.avatar} color={bot.color} size="md" />
        <div className="min-w-0">
          <h1 className="truncate text-[15px] font-semibold tracking-tight" title={bot.name}>{bot.name}</h1>
          {context && <p className="truncate text-xs text-muted" title={context}>{context}</p>}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <IconButton label={t('ui.newChat')} onPress={() => navigate('/bots/new')}><Icon name="plus" size={19} /></IconButton>
          <IconButton label={t('bot.computers')} onPress={() => openPanel('computers')}><Icon name="monitor" size={19} /></IconButton>
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
      <div className="flex min-h-0 min-w-0 flex-1"><ChatTab bot={bot} onOpenSettings={() => openPanel('settings')} onOpenComputers={takeover => openPanel('computers', takeover)} /></div>

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
    </div>
  );
}

export function RequireBot({ children }: { children: React.ReactNode }) {
  const { botId = '' } = useParams();
  const { state } = useLive();
  if (!state.bots.some(bot => bot.id === botId)) return <Navigate to="/" replace />;
  return <>{children}</>;
}
