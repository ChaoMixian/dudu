import { useId, useLayoutEffect, useRef, useState } from 'react';
import { Alert, AlertDialog, Button, Checkbox, Chip, EmptyState, Form, Input, Label, ListBox, Modal, Select, Spinner, TextField } from '@heroui/react';
import { ChevronDown, Pencil, Plus, RefreshCw, Save, Server, Trash2 } from 'lucide-react';
import type { ProviderConfig } from '../../contracts';
import { errorText, request } from '../lib/api';
import { useI18n } from '../i18n';
import { useAuth } from '../auth/AuthContext';
import { useLive } from '../state/LiveContext';
import IconButton from '../ui/IconButton';
import Icon from '../ui/Icon';
import { buildProvider, mergeProvider, newModelDraft, providerConflict, providerDraft, providerFingerprint, providerReferences, PROVIDER_APIS, removeProvider, type ModelDraft, type ProviderDraft } from './provider-forms';

const API_LABEL = {
  'openai-completions': 'providers.apiCompletions',
  'openai-responses': 'providers.apiResponses',
  'anthropic-messages': 'providers.apiAnthropic',
} as const;

interface ProvidersPageProps {
  onDirtyChange?: (dirty: boolean) => void;
  onPendingChange?: (pending: boolean) => void;
}
type Editor = { draft: ProviderDraft; baseline: string; original?: ProviderConfig };

export default function ProvidersPage({ onDirtyChange, onPendingChange }: ProvidersPageProps = {}) {
  const { state, loaded, busy, run } = useLive();
  const { token } = useAuth();
  const { t } = useI18n();
  const formId = useId();
  const latest = useRef(state);
  useLayoutEffect(() => { latest.current = state; }, [state]);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const [deleting, setDeleting] = useState<ProviderConfig | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [error, setError] = useState('');
  const [discovery, setDiscovery] = useState<{ text: string; error: boolean } | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const nextModelKey = useRef(0);
  const dirty = !!editor && providerFingerprint(editor.draft) !== editor.baseline;
  const blocked = !!busy || pending || !loaded;
  const conflict = !!editor?.original && providerConflict(state.providers, editor.original);
  const deleteConflict = !!deleting && providerConflict(state.providers, deleting);
  const references = deleting ? providerReferences(state.bots, deleting.id) : [];
  const defaultOptions = state.providers.flatMap(provider => provider.models.map(model => ({
    key: `${provider.id}|${model.id}`,
    label: `${provider.name || provider.id} · ${model.name || model.id}`,
  })));
  const currentDefault = state.defaults?.provider && state.defaults?.model ? `${state.defaults.provider}|${state.defaults.model}` : 'none';
  const saveDefault = (key: string) => {
    const [provider, model] = key === 'none' ? [undefined, undefined] : key.split('|');
    void run(t('providers.saveDefault'), () => request(token, '/defaults', 'PUT', { provider, model }));
  };

  useLayoutEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useLayoutEffect(() => { onPendingChange?.(pending); }, [pending, onPendingChange]);

  const openEditor = (original?: ProviderConfig) => {
    if (blocked || pendingRef.current) return;
    const draft = providerDraft(original);
    nextModelKey.current = draft.models.length;
    setExpanded(new Set());
    setEditor({ draft, baseline: providerFingerprint(draft), original });
    setError('');
    setDiscovery(null);
  };
  const closeEditor = () => {
    if (pendingRef.current) return;
    if (dirty) setDiscarding(true);
    else { setEditor(null); setError(''); setDiscovery(null); }
  };
  const updateDraft = (patch: Partial<ProviderDraft>) => setEditor(current => current ? { ...current, draft: { ...current.draft, ...patch } } : current);
  const updateModel = (key: number, patch: Partial<ModelDraft>) => setEditor(current => current ? {
    ...current, draft: { ...current.draft, models: current.draft.models.map(model => model.key === key ? { ...model, ...patch } : model) },
  } : current);
  const toggleExpanded = (key: number) => setExpanded(current => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const persist = async (label: string, prepare: () => ProviderConfig[], succeeded: () => void) => {
    if (blocked || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    onPendingChange?.(true);
    setError('');
    let failure = '';
    try {
      const ok = await run(label, async () => {
        try {
          await request(token, '/providers', 'PUT', { providers: prepare() });
        } catch (cause) { failure = errorText(cause); throw cause; }
      });
      if (ok) succeeded();
      else setError(failure || t('form.saveFailed'));
    } catch (cause) { setError(errorText(cause)); }
    finally { pendingRef.current = false; setPending(false); onPendingChange?.(false); }
  };
  const save = () => {
    if (!editor || blocked || pendingRef.current) return;
    setError('');
    let replacement: ProviderConfig;
    try { replacement = buildProvider(editor.draft, editor.original, t); }
    catch (cause) { setError(errorText(cause)); return; }
    void persist(t('providers.saveProvider'), () => mergeProvider(latest.current.providers, editor.original, replacement, t), () => {
      setEditor(null); onDirtyChange?.(false);
    });
  };
  const remove = () => {
    if (!deleting) return;
    void persist(t('providers.remove'), () => removeProvider(latest.current.providers, latest.current.bots, deleting, t), () => setDeleting(null));
  };

  const discoverModels = async () => {
    if (!editor || discovering) return;
    setDiscovery(null);
    setDiscovering(true);
    try {
      const result = await request<{ models: { id: string; name: string }[] }>(token, '/providers/models', 'POST', {
        api: editor.draft.api, baseUrl: editor.draft.baseUrl, apiKey: editor.draft.apiKey,
      });
      const existing = new Set(editor.draft.models.map(model => model.id.trim()).filter(Boolean));
      const additions = result.models.filter(model => !existing.has(model.id));
      if (!additions.length) {
        setDiscovery({ text: t('providers.noNewModels'), error: false });
        return;
      }
      setEditor(current => {
        if (!current) return current;
        const keep = current.draft.models.filter(model => model.id.trim());
        return {
          ...current,
          draft: {
            ...current.draft,
            models: [...keep, ...additions.map(model => ({ ...newModelDraft(nextModelKey.current++), id: model.id, name: model.name === model.id ? '' : model.name }))],
          },
        };
      });
      setDiscovery({ text: t('providers.discovered', { n: additions.length }), error: false });
    } catch (cause) {
      setDiscovery({ text: errorText(cause), error: true });
    } finally {
      setDiscovering(false);
    }
  };

  const errorAlert = error && <Alert status="danger" role="alert"><Alert.Content><Alert.Description>{error}</Alert.Description></Alert.Content></Alert>;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-2xl font-semibold tracking-tight">{t('providers.title')}</h2>
          <p className="mt-1.5 text-sm text-muted">{t('providers.desc')}</p>
        </div>
        <Button className="rounded-full" variant="secondary" isDisabled={blocked} onPress={() => openEditor()}><Plus size={17} aria-hidden="true" />{t('providers.add')}</Button>
      </header>

      <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-separator bg-surface px-5 py-4" aria-label={t('providers.defaultModel')}>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{t('providers.defaultModel')}</h3>
          <p className="mt-0.5 text-xs text-muted">{t('providers.defaultHint')}</p>
        </div>
        <Select isDisabled={blocked || !defaultOptions.length} selectedKey={currentDefault} onSelectionChange={key => { if (key !== null) saveDefault(String(key)); }}>
          <Label className="sr-only">{t('providers.defaultModel')}</Label>
          <Select.Trigger className="min-w-56 rounded-xl"><Select.Value /><Select.Indicator /></Select.Trigger>
          <Select.Popover><ListBox items={[{ key: 'none', label: t('providers.defaultNone') }, ...defaultOptions]}>
            {option => <ListBox.Item id={option.key} textValue={option.label}>{option.label}</ListBox.Item>}
          </ListBox></Select.Popover>
        </Select>
      </section>

      <section className="flex min-w-0 flex-col gap-3" aria-label={t('providers.title')}>
        {!state.providers.length ? (
          <EmptyState className="rounded-2xl border border-separator bg-surface px-6 py-14">
            <Server size={28} aria-hidden="true" />
            <p>{loaded ? t('providers.none') : t('ui2.loading')}</p>
          </EmptyState>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-separator bg-surface">
            {state.providers.map((provider, index) => (
              <article key={provider.id} className={`flex min-w-0 items-start gap-4 px-5 py-4 transition-colors hover:bg-surface-secondary/60 ${index ? 'border-t border-separator' : ''}`}>
                <div className="provider-glyph" aria-hidden="true"><Server size={18} /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <h3 className="truncate text-[15px] font-semibold tracking-tight">{provider.name || provider.id}</h3>
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                      <span className={`size-1.5 rounded-full ${provider.apiKey ? 'bg-success' : 'bg-muted'}`} />
                      {provider.apiKey ? t('providers.credentialSet') : t('providers.credentialNone')}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted"><span className="text-foreground/60">{t(API_LABEL[provider.api])}</span><span className="px-1.5 text-muted/50">·</span>{provider.baseUrl}</p>
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {provider.models.map(model => <Chip key={model.id} size="sm" variant="soft" title={model.name}>{model.id}</Chip>)}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <IconButton label={`${t('providers.edit')} ${provider.id}`} isDisabled={blocked} onPress={() => openEditor(provider)}><Pencil size={16} aria-hidden="true" /></IconButton>
                  <IconButton label={`${t('providers.remove')} ${provider.id}`} isDisabled={blocked} onPress={() => { setError(''); setDeleting(provider); }}><Trash2 size={16} aria-hidden="true" /></IconButton>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <Modal isOpen={!!editor} onOpenChange={open => { if (!open) closeEditor(); }}>
        <Modal.Backdrop isDismissable={!pending} isKeyboardDismissDisabled={pending}>
          <Modal.Container size="lg" scroll="inside" placement="center">
            <Modal.Dialog>
              <Modal.Header>
                <div className="flex w-full items-start justify-between gap-4">
                  <div>
                    <Modal.Heading>{editor?.original ? t('providers.edit') : t('providers.add')}</Modal.Heading>
                    <p className="mt-1 text-sm text-muted">{t('providers.dialogHint')}</p>
                  </div>
                  <IconButton label={t('common.close')} isDisabled={pending} onPress={closeEditor}><Icon name="close" size={18} /></IconButton>
                </div>
              </Modal.Header>
              <Modal.Body>
                {editor && <Form id={formId} validationBehavior="aria" aria-busy={pending} className="flex min-w-0 flex-col gap-6" onSubmit={event => { event.preventDefault(); save(); }}>
                  {conflict && <Alert status="warning" role="alert"><Alert.Content><Alert.Description>{t('providers.conflict')}</Alert.Description></Alert.Content></Alert>}
                  {errorAlert}

                  <section className="form-section">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <TextField isRequired isDisabled={pending} value={editor.draft.name} onChange={name => updateDraft({ name })}>
                        <Label>{t('providers.name')}</Label><Input autoFocus maxLength={80} placeholder={t('providers.namePlaceholder')} />
                      </TextField>
                      <Select isDisabled={pending} selectedKey={editor.draft.api} onSelectionChange={key => { if (key !== null) updateDraft({ api: String(key) as ProviderConfig['api'] }); }}>
                        <Label>{t('providers.api')}</Label>
                        <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                        <Select.Popover><ListBox>{PROVIDER_APIS.map(api => <ListBox.Item key={api} id={api} textValue={t(API_LABEL[api])}>{t(API_LABEL[api])}</ListBox.Item>)}</ListBox></Select.Popover>
                      </Select>
                    </div>
                    <TextField isRequired isDisabled={pending} value={editor.draft.baseUrl} onChange={baseUrl => updateDraft({ baseUrl })}>
                      <Label>{t('providers.baseUrl')}</Label><Input type="url" spellCheck={false} placeholder="https://api.example.com/v1" />
                    </TextField>
                    <TextField isDisabled={pending} value={editor.draft.apiKey} onChange={apiKey => updateDraft({ apiKey })}>
                      <Label>{t('providers.apiKey')}</Label><Input type="password" autoComplete="off" spellCheck={false} placeholder="sk-…" />
                    </TextField>
                  </section>

                  <section className="form-section" aria-label={t('providers.models')}>
                    <div className="flex flex-wrap items-end justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold">{t('providers.models')}</h3>
                        <p className="mt-0.5 text-xs text-muted">{t('providers.modelsCount', { n: editor.draft.models.length })}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button type="button" size="sm" variant="ghost" isDisabled={pending || discovering || !editor.draft.baseUrl.trim()} onPress={() => void discoverModels()}>
                          {discovering ? <Spinner size="sm" /> : <RefreshCw size={15} aria-hidden="true" />}{discovering ? t('providers.discovering') : t('providers.discover')}
                        </Button>
                        <Button type="button" size="sm" variant="secondary" isDisabled={pending} onPress={() => updateDraft({ models: [...editor.draft.models, newModelDraft(nextModelKey.current++)] })}><Plus size={15} aria-hidden="true" />{t('providers.addModel')}</Button>
                      </div>
                    </div>
                    {discovery && <p className={`text-xs ${discovery.error ? 'text-danger' : 'text-muted'}`} role="status">{discovery.text}</p>}
                    <div className="flex flex-col gap-2.5">
                      {editor.draft.models.map((model, index) => {
                        const open = expanded.has(model.key);
                        return <div key={model.key} className="rounded-xl border border-separator bg-surface-secondary/40 p-3">
                          <div className="flex items-start gap-2.5">
                            <div className="grid min-w-0 flex-1 gap-2.5 sm:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
                              <TextField isRequired isDisabled={pending} value={model.id} onChange={id => updateModel(model.key, { id })}>
                                <Label className="text-xs">{t('providers.modelId')}</Label><Input spellCheck={false} className="font-mono" placeholder={index === 0 ? 'gpt-4.1' : 'model-id'} />
                              </TextField>
                              <TextField isDisabled={pending} value={model.name} onChange={name => updateModel(model.key, { name })}>
                                <Label className="text-xs">{t('providers.modelName')}</Label><Input placeholder={t('providers.modelNamePlaceholder')} />
                              </TextField>
                            </div>
                            <div className="flex shrink-0 items-center gap-0.5 pt-5">
                              <IconButton label={t('providers.modelAdvanced')} isDisabled={pending} onPress={() => toggleExpanded(model.key)}><ChevronDown size={16} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} aria-hidden="true" /></IconButton>
                              <IconButton label={t('providers.removeModel', { n: index + 1 })} isDisabled={pending} onPress={() => updateDraft({ models: editor.draft.models.filter(row => row.key !== model.key) })}><Trash2 size={15} aria-hidden="true" /></IconButton>
                            </div>
                          </div>
                          {open && <div className="mt-3 flex flex-col gap-3 border-t border-separator pt-3">
                            <Checkbox isDisabled={pending} isSelected={model.reasoning} onChange={reasoning => updateModel(model.key, { reasoning })}><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control><Label>{t('providers.reasoning')}</Label></Checkbox.Content></Checkbox>
                            <div className="grid gap-3 sm:grid-cols-2">
                              <TextField isDisabled={pending} value={model.contextWindow} onChange={contextWindow => updateModel(model.key, { contextWindow })}><Label className="text-xs">{t('providers.contextWindow')}</Label><Input inputMode="numeric" placeholder="128000" /></TextField>
                              <TextField isDisabled={pending} value={model.maxTokens} onChange={maxTokens => updateModel(model.key, { maxTokens })}><Label className="text-xs">{t('providers.maxTokens')}</Label><Input inputMode="numeric" placeholder="16384" /></TextField>
                            </div>
                          </div>}
                        </div>;
                      })}
                    </div>
                  </section>
                </Form>}
              </Modal.Body>
              <Modal.Footer>
                <Button variant="tertiary" isDisabled={pending} onPress={closeEditor}>{t('common.cancel')}</Button>
                <Button className="rounded-full" type="submit" form={formId} variant="secondary" isDisabled={blocked || conflict} isPending={pending}>{pending ? <Spinner size="sm" /> : <Save size={16} aria-hidden="true" />}{t('providers.saveProvider')}</Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      <AlertDialog isOpen={discarding} onOpenChange={open => { if (!pendingRef.current) setDiscarding(open); }}>
        <AlertDialog.Backdrop><AlertDialog.Container><AlertDialog.Dialog>
          <AlertDialog.Header><AlertDialog.Heading>{t('common.unsavedTitle')}</AlertDialog.Heading></AlertDialog.Header>
          <AlertDialog.Body>{t('common.unsavedBody')}</AlertDialog.Body>
          <AlertDialog.Footer><Button autoFocus variant="tertiary" onPress={() => setDiscarding(false)}>{t('common.keepEditing')}</Button><Button variant="secondary" onPress={() => { if (pendingRef.current) return; setDiscarding(false); setEditor(null); setError(''); setDiscovery(null); onDirtyChange?.(false); }}>{t('common.discard')}</Button></AlertDialog.Footer>
        </AlertDialog.Dialog></AlertDialog.Container></AlertDialog.Backdrop>
      </AlertDialog>

      <AlertDialog isOpen={!!deleting} onOpenChange={open => { if (!open && !pendingRef.current) { setDeleting(null); setError(''); } }}>
        <AlertDialog.Backdrop isKeyboardDismissDisabled={pending}><AlertDialog.Container><AlertDialog.Dialog>
          <AlertDialog.Header><AlertDialog.Heading>{t('providers.remove')}</AlertDialog.Heading></AlertDialog.Header>
          <AlertDialog.Body className="flex flex-col gap-3">
            <p>{t('providers.removeConfirm', { id: deleting?.id ?? '' })}</p>
            <h3 className="text-sm font-medium">{t('providers.referencedBy')}</h3>
            {references.length ? <><ul className="flex flex-col gap-1">{references.map(bot => <li key={bot.id} className="break-words text-sm">{bot.name} ({bot.id})</li>)}</ul><p className="text-sm text-muted">{t('providers.removeBlocked')}</p></> : <p className="text-sm text-muted">{t('providers.noReferences')}</p>}
            {deleteConflict && <Alert status="warning" role="alert"><Alert.Content><Alert.Description>{t('providers.conflict')}</Alert.Description></Alert.Content></Alert>}
            {errorAlert}
          </AlertDialog.Body>
          <AlertDialog.Footer><Button autoFocus variant="tertiary" isDisabled={pending} onPress={() => { setDeleting(null); setError(''); }}>{t('common.cancel')}</Button><Button variant="secondary" isDisabled={blocked || !!references.length || deleteConflict} isPending={pending} onPress={remove}>{pending ? <Spinner size="sm" /> : <Trash2 size={16} aria-hidden="true" />}{t('providers.remove')}</Button></AlertDialog.Footer>
        </AlertDialog.Dialog></AlertDialog.Container></AlertDialog.Backdrop>
      </AlertDialog>
    </div>
  );
}
