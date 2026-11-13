import { useEffect, useId, useRef, useState } from 'react';
import { Alert, AlertDialog, Button, Checkbox, Chip, Description, EmptyState, Form, Input, Label, ListBox, Modal, Select, Spinner, TextArea, TextField } from '@heroui/react';
import { Plus, Trash2, Zap } from 'lucide-react';
import type { SourceConfig } from '../../contracts';
import { errorText, request, segment } from '../lib/api';
import { emptySourceDraft, sourceFromDraft, SourceDraftError, type SourceDraft } from '../lib/source-form';
import { useI18n, type TFunction } from '../i18n';
import { useAuth } from '../auth/AuthContext';
import { useLive } from '../state/LiveContext';
import ArgumentEditor from '../ui/ArgumentEditor';
import StringMapEditor from '../ui/StringMapEditor';

interface SourcesPageProps {
  onDirtyChange?: (dirty: boolean) => void;
  onPendingChange?: (pending: boolean) => void;
}

function configuration(source: SourceConfig, t: TFunction, locale: string): string {
  switch (source.kind) {
    case 'once': return source.at && Number.isFinite(Date.parse(source.at)) ? new Date(source.at).toLocaleString(locale) : '—';
    case 'interval': {
      const value = source.intervalMs ?? 0;
      const [unit, divisor] = value && value % 86_400_000 === 0 ? ['days', 86_400_000] as const : value && value % 3_600_000 === 0 ? ['hours', 3_600_000] as const : ['minutes', 60_000] as const;
      return `${value / divisor} ${t(`sources.form.${unit}`)}`;
    }
    case 'cron': return `${source.cron ?? '—'}${source.timezone ? ` · ${source.timezone}` : ''}`;
    case 'process': return source.argv?.join(' · ') ?? '—';
    case 'webhook': return source.type ?? 'source.webhook';
  }
}

function taskText(source: SourceConfig): string | undefined {
  if (source.payload && typeof source.payload === 'object' && 'task' in source.payload && typeof source.payload.task === 'string') return source.payload.task;
}

export default function SourcesPage({ onDirtyChange, onPendingChange }: SourcesPageProps = {}) {
  const { state, busy, loaded, run } = useLive();
  const { token } = useAuth();
  const { t, locale } = useI18n();
  const formId = useId();
  const errorId = useId();
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState(emptySourceDraft);
  const [baseline, setBaseline] = useState(() => JSON.stringify(emptySourceDraft()));
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [pending, setPending] = useState('');
  const pendingRef = useRef(false);
  const registeredIds = useRef(new Set<string>());
  const [removing, setRemoving] = useState<SourceConfig | null>(null);
  const [removeError, setRemoveError] = useState('');
  const [draftAction, setDraftAction] = useState<'close' | 'example' | null>(null);
  const blocked = Boolean(busy || pending || !loaded);
  const dirty = JSON.stringify(draft) !== baseline;
  const formDisabled = Boolean(pending || draftAction);

  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { onPendingChange?.(Boolean(pending)); }, [pending, onPendingChange]);

  const change = <K extends keyof SourceDraft>(key: K, value: SourceDraft[K]) => {
    if (!pendingRef.current && !draftAction) setDraft(current => ({ ...current, [key]: value }));
  };

  const perform = async (key: string, label: string, path: string, method = 'POST', body?: unknown, reportError = setActionError) => {
    if (blocked || pendingRef.current) return false;
    pendingRef.current = true;
    setPending(key);
    try {
      return await run(label, async () => {
        reportError('');
        try { await request(token, path, method, body); }
        catch (cause) { reportError(errorText(cause)); throw cause; }
      });
    } catch (cause) { reportError(errorText(cause)); return false; }
    finally { pendingRef.current = false; setPending(''); }
  };

  const resetDraft = (next: SourceDraft) => {
    setDraft(next); setBaseline(JSON.stringify(next)); setError(''); setDraftAction(null);
  };
  const closeForm = () => {
    if (pendingRef.current) return;
    if (dirty) setDraftAction('close');
    else setCreating(false);
  };
  const loadExample = () => {
    if (blocked || pendingRef.current) return;
    resetDraft({ ...emptySourceDraft(), id: 'daily-check', priority: 'low', task: t('sources.form.exampleTask') });
  };
  const confirmDraftAction = () => {
    if (pendingRef.current) return;
    if (draftAction === 'example') loadExample();
    else { resetDraft(emptySourceDraft()); setCreating(false); }
  };

  const register = async () => {
    if (blocked || pendingRef.current || draftAction) return;
    setError('');
    try {
      const body = sourceFromDraft(draft, state.bots.map(bot => bot.id), [...state.sources.map(source => source.id), ...registeredIds.current]);
      const ok = await perform('register', t('sources.register'), '/sources', 'POST', body, setError);
      if (ok) {
        registeredIds.current.add(body.id);
        resetDraft(emptySourceDraft());
        setCreating(false);
      }
    } catch (cause) {
      if (cause instanceof SourceDraftError) {
        const issue = cause.issue;
        setError(issue === 'bot' ? t('sources.needBot') : issue === 'duplicate' ? t('sources.duplicateId', { id: draft.id }) : t(`sources.form.validation.${issue}`));
      } else setError(errorText(cause));
    }
  };

  const remove = async () => {
    if (!removing || blocked || pendingRef.current) return;
    setRemoveError('');
    const ok = await perform(`remove:${removing.id}`, t('sources.remove'), `/sources/${segment(removing.id)}`, 'DELETE', undefined, setRemoveError);
    if (ok) { registeredIds.current.delete(removing.id); setRemoving(null); }
  };

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div><h2 className="text-2xl font-semibold tracking-tight">{t('ui.automations')}</h2><p className="mt-1.5 text-sm text-muted">{t('sources.list', { n: state.sources.length })}</p></div>
        <Button className="rounded-full" variant="secondary" aria-haspopup="dialog" isDisabled={Boolean(pending)} onPress={() => { if (!pendingRef.current) setCreating(true); }}>
          <Plus size={16} aria-hidden="true" />{t('sources.register')}
        </Button>
      </header>

      <Modal isOpen={creating} onOpenChange={open => { if (!open) closeForm(); }}>
        <Modal.Backdrop isDismissable={!pending} isKeyboardDismissDisabled={Boolean(pending)}>
          <Modal.Container size="lg" scroll="inside" placement="center">
            <Modal.Dialog>
              <Modal.Header><Modal.Heading>{t('sources.register')}</Modal.Heading></Modal.Header>
              <Modal.Body>
                <Form id={formId} className="flex min-w-0 flex-col gap-4" aria-busy={pending === 'register'} aria-describedby={error ? errorId : undefined} validationBehavior="aria" onSubmit={event => { event.preventDefault(); void register(); }}>
                  <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                    <TextField value={draft.id} onChange={value => change('id', value)} isRequired isDisabled={formDisabled}>
                      <Label>{t('sources.form.id')}</Label><Input autoComplete="off" maxLength={64} /><Description>{t('sources.form.idHelp')}</Description>
                    </TextField>
                    <Select selectedKey={draft.botId || null} onSelectionChange={key => change('botId', key === null ? '' : String(key))} isRequired isDisabled={formDisabled}>
                      <Label>{t('sources.bot')}</Label>
                      <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                      <Select.Popover><ListBox>{state.bots.map(bot => <ListBox.Item key={bot.id} id={bot.id} textValue={`${bot.name} (${bot.id})`}>{bot.name} ({bot.id})</ListBox.Item>)}</ListBox></Select.Popover>
                      {!state.bots.length && <Description>{t('sources.needBot')}</Description>}
                    </Select>
                    <Select selectedKey={draft.kind} onSelectionChange={key => { if (key !== null) change('kind', String(key) as SourceDraft['kind']); }} isDisabled={formDisabled}>
                      <Label>{t('sources.colKind')}</Label>
                      <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                      <Select.Popover><ListBox>{(['once', 'interval', 'cron', 'process', 'webhook'] as const).map(kind => <ListBox.Item key={kind} id={kind} textValue={t(`sources.kind.${kind}`)}>{t(`sources.kind.${kind}`)}</ListBox.Item>)}</ListBox></Select.Popover>
                    </Select>
                    <Select selectedKey={draft.priority} onSelectionChange={key => { if (key !== null) change('priority', String(key) as SourceDraft['priority']); }} isDisabled={formDisabled}>
                      <Label>{t('sources.colPriority')}</Label>
                      <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                      <Select.Popover><ListBox>{(['high', 'normal', 'low'] as const).map(priority => <ListBox.Item key={priority} id={priority} textValue={t(`sources.priority.${priority}`)}>{t(`sources.priority.${priority}`)}</ListBox.Item>)}</ListBox></Select.Popover>
                    </Select>
                  </div>
                  <Checkbox isSelected={draft.enabled} onChange={value => change('enabled', value)} isDisabled={formDisabled}>
                    <Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control><Label>{t('sources.enabled')}</Label></Checkbox.Content>
                  </Checkbox>
                  <TextField value={draft.task} onChange={value => change('task', value)} isRequired isDisabled={formDisabled}>
                    <Label>{t('sources.form.task')}</Label><TextArea rows={4} />
                  </TextField>

                  {draft.kind === 'once' && <TextField value={draft.at} onChange={value => change('at', value)} isRequired isDisabled={formDisabled}>
                    <Label>{t('sources.form.onceAt')}</Label><Input type="datetime-local" step={60} />
                  </TextField>}

                  {draft.kind === 'interval' && <div className="grid gap-4 sm:grid-cols-2">
                    <TextField value={draft.intervalValue} onChange={value => change('intervalValue', value)} isRequired isDisabled={formDisabled}>
                      <Label>{t('sources.form.intervalValue')}</Label><Input type="number" step="any" min="0" />
                    </TextField>
                    <Select selectedKey={draft.intervalUnit} onSelectionChange={key => { if (key !== null) change('intervalUnit', String(key) as SourceDraft['intervalUnit']); }} isDisabled={formDisabled}>
                      <Label>{t('sources.form.intervalUnit')}</Label><Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                      <Select.Popover><ListBox>{(['minutes', 'hours', 'days'] as const).map(unit => <ListBox.Item key={unit} id={unit} textValue={t(`sources.form.${unit}`)}>{t(`sources.form.${unit}`)}</ListBox.Item>)}</ListBox></Select.Popover>
                    </Select>
                  </div>}

                  {draft.kind === 'cron' && <div className="grid gap-4 sm:grid-cols-2">
                    <Select selectedKey={draft.schedule} onSelectionChange={key => { if (key !== null) change('schedule', String(key) as SourceDraft['schedule']); }} isDisabled={formDisabled}>
                      <Label>{t('sources.form.schedule')}</Label><Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                      <Select.Popover><ListBox>{(['daily', 'weekdays', 'weekly'] as const).map(preset => <ListBox.Item key={preset} id={preset} textValue={t(`sources.form.${preset}`)}>{t(`sources.form.${preset}`)}</ListBox.Item>)}</ListBox></Select.Popover>
                    </Select>
                    <TextField value={draft.time} onChange={value => change('time', value)} isRequired isDisabled={formDisabled}>
                      <Label>{t('sources.form.time')}</Label><Input type="time" step={60} />
                    </TextField>
                    {draft.schedule === 'weekly' && <Select selectedKey={draft.weekday} onSelectionChange={key => { if (key !== null) change('weekday', String(key)); }} isDisabled={formDisabled}>
                      <Label>{t('sources.form.weekday')}</Label><Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                      <Select.Popover><ListBox>{(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const).map((day, index) => <ListBox.Item key={index} id={String(index)} textValue={t(`sources.form.${day}`)}>{t(`sources.form.${day}`)}</ListBox.Item>)}</ListBox></Select.Popover>
                    </Select>}
                    <TextField value={draft.timezone} onChange={value => change('timezone', value)} isRequired isDisabled={formDisabled}>
                      <Label>{t('sources.form.timezone')}</Label><Input autoComplete="off" placeholder="Asia/Shanghai" /><Description>{t('sources.form.timezoneHelp')}</Description>
                    </TextField>
                  </div>}

                  {draft.kind === 'process' && <div className="flex min-w-0 flex-col gap-4">
                    <TextField value={draft.executable} onChange={value => change('executable', value)} isRequired isDisabled={formDisabled}>
                      <Label>{t('sources.form.executable')}</Label><Input autoComplete="off" /><Description>{t('sources.form.processHelp')}</Description>
                    </TextField>
                    <ArgumentEditor value={draft.arguments} onChange={value => change('arguments', value)} disabled={formDisabled} />
                    <StringMapEditor label={t('sources.form.environment')} value={draft.env} onChange={value => change('env', value)} disabled={formDisabled} />
                  </div>}

                  {draft.kind === 'webhook' && <TextField value={draft.eventType} onChange={value => change('eventType', value)} isRequired isDisabled={formDisabled}>
                    <Label>{t('sources.form.eventType')}</Label><Input autoComplete="off" /><Description className="break-words">{t('sources.form.webhookHelp', { id: draft.id || ':id' })}</Description>
                  </TextField>}

                  {error && <Alert id={errorId} status="danger" role="alert"><Alert.Content><Alert.Title>{t('status.error')}</Alert.Title><Alert.Description>{error}</Alert.Description></Alert.Content></Alert>}
                </Form>
              </Modal.Body>
              <Modal.Footer className="flex-wrap">
                <Button variant="tertiary" isDisabled={blocked || Boolean(draftAction)} onPress={() => { if (dirty) setDraftAction('example'); else loadExample(); }}>{t('sources.loadExample')}</Button>
                <Button variant="tertiary" isDisabled={Boolean(pending || draftAction)} onPress={closeForm}>{t('common.close')}</Button>
                <Button type="submit" form={formId} variant="secondary" isDisabled={blocked || Boolean(draftAction)} isPending={pending === 'register'}>{pending === 'register' && <Spinner size="sm" />}{t('sources.submit')}</Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      {actionError && <Alert status="danger" role="alert"><Alert.Content><Alert.Title>{t('status.error')}</Alert.Title><Alert.Description>{actionError}</Alert.Description></Alert.Content></Alert>}

      <section className="flex min-w-0 flex-col gap-3" aria-label={t('ui.automations')}>
        {!state.sources.length ? (
          <EmptyState className="rounded-2xl border border-separator bg-surface px-6 py-14"><Zap size={28} aria-hidden="true" /><p>{t('sources.none')}</p></EmptyState>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-separator bg-surface">
            {state.sources.map((source, index) => {
              const bot = state.bots.find(entry => entry.id === source.botId);
              return (
                <article key={source.id} className={`flex min-w-0 flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center ${index ? 'border-t border-separator' : ''}`}>
                  <div className="provider-glyph" aria-hidden="true"><Zap size={18} /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      <h3 className="truncate text-[15px] font-semibold tracking-tight">{source.id}</h3>
                      <Chip size="sm" variant="soft">{source.enabled ? t('sources.enabled') : t('sources.disabled')}</Chip>
                      <span className="text-xs text-muted">{t(`sources.kind.${source.kind}`)}</span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted">{configuration(source, t, locale)}</p>
                    {taskText(source) && <p className="mt-2 max-w-2xl whitespace-pre-wrap break-words text-sm leading-relaxed">{taskText(source)}</p>}
                    <p className="mt-2 text-xs text-muted">{bot?.name ?? source.botId}<span className="px-1.5 text-muted/50">·</span>{t(`sources.priority.${source.priority}`)}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    <Button size="sm" variant="secondary" isDisabled={blocked || !source.enabled} isPending={pending === `trigger:${source.id}`} aria-label={`${t('sources.trigger')} ${source.id}`} onPress={() => { void perform(`trigger:${source.id}`, t('sources.trigger'), `/sources/${segment(source.id)}/trigger`); }}>{t('sources.trigger')}</Button>
                    <Button size="sm" variant="tertiary" isDisabled={blocked} isPending={pending === `toggle:${source.id}`} aria-label={`${source.enabled ? t('sources.disable') : t('sources.enable')} ${source.id}`} onPress={() => { void perform(`toggle:${source.id}`, source.enabled ? t('sources.disable') : t('sources.enable'), `/sources/${segment(source.id)}/${source.enabled ? 'disable' : 'enable'}`); }}>{source.enabled ? t('sources.disable') : t('sources.enable')}</Button>
                    <Button size="sm" variant="tertiary" isDisabled={blocked} aria-label={`${t('sources.remove')} ${source.id}`} onPress={() => { setRemoveError(''); setRemoving(source); }}><Trash2 size={14} aria-hidden="true" />{t('sources.remove')}</Button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <AlertDialog isOpen={Boolean(removing)} onOpenChange={open => { if (!open && !pendingRef.current) setRemoving(null); }}>
        <AlertDialog.Backdrop isKeyboardDismissDisabled={Boolean(pending)}>
          <AlertDialog.Container><AlertDialog.Dialog>
            <AlertDialog.Header><AlertDialog.Heading>{t('sources.remove')} · {removing?.id}</AlertDialog.Heading></AlertDialog.Header>
            <AlertDialog.Body><p>{t('sources.removeConfirm')}</p><p className="my-3 break-words text-sm text-muted">{t('sources.bot')}: {removing?.botId} · {removing ? t(`sources.kind.${removing.kind}`) : ''}</p>{removeError && <Alert status="danger" role="alert"><Alert.Content><Alert.Description>{removeError}</Alert.Description></Alert.Content></Alert>}</AlertDialog.Body>
            <AlertDialog.Footer>
              <Button variant="tertiary" autoFocus isDisabled={Boolean(pending)} onPress={() => { if (!pendingRef.current) setRemoving(null); }}>{t('common.close')}</Button>
              <Button variant="danger" isDisabled={blocked || !state.sources.some(source => source.id === removing?.id)} isPending={pending.startsWith('remove:')} onPress={() => { void remove(); }}>{pending.startsWith('remove:') && <Spinner size="sm" />}{t('sources.remove')} {removing?.id}</Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog></AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>

      <AlertDialog isOpen={Boolean(draftAction)} onOpenChange={open => { if (!open) setDraftAction(null); }}>
        <AlertDialog.Backdrop><AlertDialog.Container><AlertDialog.Dialog>
          <AlertDialog.Header><AlertDialog.Heading>{t(draftAction === 'example' ? 'common.replaceDraft' : 'common.unsavedTitle')}</AlertDialog.Heading></AlertDialog.Header>
          <AlertDialog.Body>{t(draftAction === 'example' ? 'common.replaceDraftBody' : 'common.unsavedBody')}</AlertDialog.Body>
          <AlertDialog.Footer>
            <Button variant="tertiary" autoFocus onPress={() => setDraftAction(null)}>{t('common.keepEditing')}</Button>
            <Button variant="secondary" isDisabled={Boolean(pending) || (draftAction === 'example' && blocked)} onPress={confirmDraftAction}>{t(draftAction === 'example' ? 'sources.loadExample' : 'common.discard')}</Button>
          </AlertDialog.Footer>
        </AlertDialog.Dialog></AlertDialog.Container></AlertDialog.Backdrop>
      </AlertDialog>
    </div>
  );
}
