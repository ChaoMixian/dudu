import { useEffect, useRef, useState } from 'react';
import { Alert, AlertDialog, Button, Card, Checkbox, Form, Input, Label, ListBox, Modal, Select, Spinner, TextArea, TextField } from '@heroui/react';
import { CheckCircle2, LogIn, Plus, RefreshCw, Settings2, Trash2, X } from 'lucide-react';
import type { ConnectorDefinition, ConnectorTool } from '../../contracts';
import type { ConnectorView } from '../lib/types';
import { errorText, request, segment } from '../lib/api';
import { useI18n } from '../i18n';
import { useAuth } from '../auth/AuthContext';
import { useLive } from '../state/LiveContext';
import ArgumentEditor from '../ui/ArgumentEditor';
import StringMapEditor, { entriesMap, mapEntries, type StringEntry } from '../ui/StringMapEditor';
import DiscardChangesDialog from '../ui/DiscardChangesDialog';
import IconButton from '../ui/IconButton';
import ConnectorAuth from '../connectors/ConnectorAuth';
import ProviderIcon from '../connectors/ProviderIcon';
import ConnectionSection from '../connectors/ConnectionSection';
import { fieldVisible, providerConnected, type AuthFlow, type CatalogField, type CatalogProvider } from '../connectors/model';

type Connector = ConnectorDefinition & { headers?: Record<string, string>; timeoutMs?: number };
type Schema = Record<string, unknown>;
type Parameter = { name: string; type: string; description: string; required: boolean; original: Schema };
type ToolDraft = { name: string; description: string; fields: Parameter[]; original: ConnectorTool };
type Draft = { id: string; name: string; description: string; transport: Connector['transport']; remote: boolean; url: string; command: string; args: string[]; env: StringEntry[]; headers: StringEntry[]; timeout: string; tools: ToolDraft[]; original?: Connector };
type BuiltinDraft = { id: string; name: string; provider: string; settings: Record<string, unknown>; credentials: Record<string, string> };
const types = ['string', 'number', 'integer', 'boolean', 'object', 'array'] as const;
const schema = (value: unknown): Schema => value && typeof value === 'object' && !Array.isArray(value) ? value as Schema : {};
function toolDraft(tool: ConnectorTool): ToolDraft {
  const parameters = schema(tool.parameters);
  const required = Array.isArray(parameters.required) ? parameters.required : [];
  return { name: tool.name, description: tool.description, original: tool, fields: Object.entries(schema(parameters.properties)).map(([name, value]) => {
    const field = schema(value);
    return { name, type: typeof field.type === 'string' ? field.type : 'string', description: typeof field.description === 'string' ? field.description : '', required: required.includes(name), original: field };
  }) };
}
function makeDraft(connector?: Connector): Draft {
  return { id: connector?.id ?? '', name: connector?.name ?? '', description: connector?.description ?? '', transport: connector?.transport ?? 'mcp', remote: Boolean(connector?.url), url: connector?.url ?? '', command: connector?.argv?.[0] ?? '', args: connector?.argv?.slice(1) ?? [], env: mapEntries(connector?.env), headers: mapEntries(connector?.headers), timeout: connector?.timeoutMs?.toString() ?? '', tools: connector?.tools.map(toolDraft) ?? [], original: connector };
}

export default function ConnectorsPage({ onDirtyChange, onPendingChange }: { onDirtyChange?: (dirty: boolean) => void; onPendingChange?: (pending: boolean) => void } = {}) {
  const { state, busy, run, refresh, notify } = useLive();
  const { token } = useAuth();
  const { t, locale } = useI18n();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [baseline, setBaseline] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [discarding, setDiscarding] = useState(false);
  const [catalog, setCatalog] = useState<CatalogProvider[]>([]);
  const [builtin, setBuiltin] = useState<BuiltinDraft | null>(null);
  const [builtinError, setBuiltinError] = useState('');
  const [builtinPending, setBuiltinPending] = useState(false);
  const [testResult, setTestResult] = useState<unknown>(null);
  const [removing, setRemoving] = useState<ConnectorView | null>(null);
  const [removeError, setRemoveError] = useState('');
  const [auth, setAuth] = useState<AuthFlow | null>(null);
  const builtinPendingRef = useRef(false);
  const connectors = state.connectors;
  const dirty = Boolean(draft && JSON.stringify(draft) !== baseline);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { onPendingChange?.(pending || builtinPending); }, [pending, builtinPending, onPendingChange]);
  useEffect(() => { void request<{ providers: CatalogProvider[] }>(token, '/connectors/catalog').then(result => setCatalog(result.providers)).catch(() => {}); }, [token]);
  const open = (connector?: Connector) => {
    const next = makeDraft(connector);
    setDraft(next); setBaseline(JSON.stringify(next)); setError('');
  };
  const close = () => { if (pendingRef.current) return; if (dirty) setDiscarding(true); else setDraft(null); };
  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(current => current ? { ...current, [key]: value } : current);
  const updateTransport = (value: string) => {
    const transport = value as Draft['transport'];
    setDraft(current => current ? { ...current, transport, ...(transport === 'mcp' ? {} : { remote: false }) } : current);
  };
  const updateTool = (index: number, value: Partial<ToolDraft>) => { if (draft) update('tools', draft.tools.map((tool, i) => i === index ? { ...tool, ...value } : tool)); };
  const updateField = (toolIndex: number, fieldIndex: number, value: Partial<Parameter>) => {
    const tool = draft?.tools[toolIndex]; if (tool) updateTool(toolIndex, { fields: tool.fields.map((field, i) => i === fieldIndex ? { ...field, ...value } : field) });
  };
  const save = async () => {
    if (!draft || busy || pendingRef.current) return;
    setError('');
    let body: Partial<Connector>;
    try {
      if (!draft.name.trim()) throw new Error(t('form.nameRequired'));
      const targetId = draft.original?.id;
      if (targetId && !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(targetId)) throw new Error(t('gui.invalidId'));
      const live = targetId ? state.connectors.find(connector => connector.id === targetId) : undefined;
      if (draft.original && JSON.stringify(live) !== JSON.stringify(draft.original)) throw new Error(t('gui.conflict'));
      const remote = draft.transport === 'http' || (draft.transport === 'mcp' && draft.remote);
      if (remote) { let url: URL; try { url = new URL(draft.url); } catch { throw new Error(t('gui.invalidUrl')); } if (!['http:', 'https:'].includes(url.protocol)) throw new Error(t('gui.invalidUrl')); }
      else if (!draft.command.trim() || [draft.command, ...draft.args].some(arg => arg.includes('\0'))) throw new Error(t('gui.commandRequired'));
      const names = new Set<string>();
      const tools = draft.tools.map(tool => {
        if (!/^[a-zA-Z0-9_-]+$/.test(tool.name) || !tool.description.trim()) throw new Error(t('gui.toolInvalid'));
        if (names.has(tool.name)) throw new Error(t('gui.duplicateTool')); names.add(tool.name);
        const fields = new Set<string>(); const properties: Record<string, unknown> = Object.create(null); const required: string[] = [];
        for (const field of tool.fields) {
          if (!field.name.trim()) throw new Error(t('gui.fieldNameRequired'));
          if (fields.has(field.name)) throw new Error(t('gui.duplicateField')); fields.add(field.name);
          const next: Schema = { ...field.original, type: field.type, description: field.description };
          if (field.type === 'array' && !next.items) next.items = { type: 'string' };
          properties[field.name] = next;
          if (field.required) required.push(field.name);
        }
        return { ...tool.original, name: tool.name, description: tool.description, parameters: { ...tool.original.parameters, type: 'object', properties, required } };
      });
      if (draft.timeout && (!Number.isFinite(Number(draft.timeout)) || Number(draft.timeout) <= 0)) throw new Error(t('gui.timeout'));
      body = { ...draft.original, ...(targetId ? { id: targetId } : {}), name: draft.name.trim(), description: draft.description, transport: draft.transport, tools, env: entriesMap(draft.env), headers: entriesMap(draft.headers), timeoutMs: draft.timeout ? Number(draft.timeout) : undefined };
      if (remote) { body.url = draft.url; delete body.argv; } else { body.argv = [draft.command, ...draft.args]; delete body.url; }
    } catch (cause) { setError(errorText(cause)); return; }
    pendingRef.current = true; setPending(true);
    try {
      const ok = await run(draft.original ? t('connectors.edit') : t('connectors.register'), async () => {
        try { await request(token, '/connectors', 'POST', body); } catch (cause) { setError(errorText(cause)); throw cause; }
      });
      if (ok) { onDirtyChange?.(false); setDraft(null); setError(''); }
    } finally { pendingRef.current = false; setPending(false); }
  };
  const providerOf = (value: string) => catalog.find(item => item.id === value);
  const fieldLabel = (field: CatalogField) => locale === 'zh' ? field.label : field.labelEn ?? field.label;
  const fieldHelp = (field: CatalogField) => locale === 'zh' ? field.help : field.helpEn ?? field.help;
  const openBuiltin = (provider: CatalogProvider, connector?: ConnectorView) => {
    const settings: Record<string, unknown> = { ...(connector?.settings ?? {}) };
    if (!connector) for (const field of provider.fields) if (field.defaultValue !== undefined) settings[field.key] = field.defaultValue;
    const next: BuiltinDraft = { id: connector?.id ?? '', name: connector?.name ?? provider.name, provider: provider.id, settings, credentials: {} };
    setBuiltin(next); setBuiltinError(''); setTestResult(null); setAuth(null);
  };
  const setBuiltinField = (field: CatalogField, value: unknown) => {
    setBuiltinError('');
    setBuiltin(current => current ? { ...current, [field.type === 'password' ? 'credentials' : 'settings']: { ...(field.type === 'password' ? current.credentials : current.settings), [field.key]: value } } : current);
  };
  const builtinConfig = (extraCredentials: Record<string, string> = {}) => {
    if (!builtin) throw new Error('No connector draft');
    const provider = providerOf(builtin.provider);
    if (!provider) throw new Error('Unknown provider');
    const existing = builtin.id ? state.connectors.find(connector => connector.id === builtin.id) : undefined;
    const settings: Record<string, unknown> = {}; const credentials: Record<string, string> = { ...extraCredentials };
    for (const field of provider.fields) {
      const value = field.type === 'password' ? builtin.credentials[field.key] : builtin.settings[field.key];
      if (field.type === 'password') { if (typeof value === 'string' && value) credentials[field.key] = value; }
      else if (value !== undefined && value !== '') settings[field.key] = value;
      if (field.required && field.type !== 'password' && (value === undefined || value === '')) throw new Error(t('connectors.required', { name: fieldLabel(field) }));
      if (field.required && field.type === 'password' && !credentials[field.key] && !existing?.credentialsSet?.includes(field.key)) throw new Error(t('connectors.required', { name: fieldLabel(field) }));
    }
    return { provider, existing, settings, credentials };
  };
  const testBuiltinDraft = async () => {
    if (!builtin || builtinPending) return;
    let config: ReturnType<typeof builtinConfig>;
    try { config = builtinConfig(); } catch (cause) { setBuiltinError(errorText(cause)); return; }
    setBuiltinPending(true); setBuiltinError(''); setTestResult(null);
    try {
      setTestResult(await request(token, '/connectors/test', 'POST', { ...(builtin.id ? { id: builtin.id } : {}), provider: config.provider.id, settings: config.settings, credentials: config.credentials }));
    } catch (cause) { setBuiltinError(t('connectors.testFailed', { error: errorText(cause) })); }
    finally { setBuiltinPending(false); }
  };
  const saveBuiltin = async (extraCredentials: Record<string, string> = {}): Promise<boolean> => {
    if (!builtin || builtinPending || builtinPendingRef.current) return false;
    if (builtin.id && !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(builtin.id)) { setBuiltinError(t('connectors.invalidId')); return false; }
    if (!builtin.name.trim()) { setBuiltinError(t('connectors.required', { name: t('gui.name') })); return false; }
    let config: ReturnType<typeof builtinConfig>;
    try { config = builtinConfig(extraCredentials); } catch (cause) { setBuiltinError(errorText(cause)); return false; }
    const { provider, settings, credentials } = config;
    builtinPendingRef.current = true; setBuiltinPending(true); setBuiltinError('');
    try {
      await request<ConnectorView>(token, '/connectors', 'POST', { ...(builtin.id ? { id: builtin.id } : {}), name: builtin.name.trim(), description: provider.description, transport: 'builtin', provider: provider.id, settings, credentials, tools: [] });
      void refresh();
      setAuth(null); setBuiltin(null); setTestResult(null);
      return true;
    } catch (cause) { setBuiltinError(errorText(cause)); return false; }
    finally { builtinPendingRef.current = false; setBuiltinPending(false); }
  };
  const closeBuiltin = () => {
    if (builtinPendingRef.current) return;
    setBuiltin(null); setAuth(null); setTestResult(null); setBuiltinError('');
  };
  const beginSetupAuth = () => {
    if (!builtin || builtinPending) return;
    if (!builtin.name.trim()) { setBuiltinError(t('connectors.required', { name: t('gui.name') })); return; }
    try { builtinConfig(); } catch (cause) { setBuiltinError(errorText(cause)); return; }
    setBuiltinError(''); setTestResult(null); setAuth({ draft: true });
  };
  const openConnectorAuth = (provider: CatalogProvider, connector: ConnectorView) => {
    openBuiltin(provider, connector);
    setAuth({ draft: false, connectorId: connector.id });
  };
  const completeAuth = async (credentials?: Record<string, string>) => {
    if (!auth) return;
    if (auth.draft) {
      if (!credentials || !Object.keys(credentials).length) { setBuiltinError(t('connectors.authMissing')); return; }
      if (await saveBuiltin(credentials)) notify('success', t('connectors.authSuccess'));
      return;
    }
    setAuth(null); setBuiltin(null); setTestResult(null); void refresh(); notify('success', t('connectors.authSuccess'));
  };
  const disconnectConnector = async (connector: ConnectorView) => {
    setBuiltinPending(true); setBuiltinError('');
    try { await request(token, `/connectors/${segment(connector.id)}/disconnect`, 'POST'); void refresh(); }
    catch (cause) { setBuiltinError(errorText(cause)); }
    finally { setBuiltinPending(false); }
  };
  const removeConnector = async () => {
    if (!removing) return;
    setBuiltinPending(true); setRemoveError('');
    try { await request(token, `/connectors/${segment(removing.id)}`, 'DELETE'); setRemoving(null); void refresh(); }
    catch (cause) { setRemoveError(errorText(cause)); }
    finally { setBuiltinPending(false); }
  };
  const formConnector = builtin ? state.connectors.find(connector => connector.id === builtin.id) : undefined;
  const formProvider = builtin ? providerOf(builtin.provider) : undefined;
  const builtinDirty = Boolean(formConnector && builtin && (builtin.name.trim() !== formConnector.name || Object.values(builtin.credentials).some(value => typeof value === 'string' && value.trim()) || JSON.stringify(builtin.settings) !== JSON.stringify(formConnector.settings ?? {})));
  const canTestForm = Boolean(builtin && formProvider && (!formProvider.connect || providerConnected(formProvider, formConnector)));
  const renderTestResult = (result: unknown, provider?: string) => {
    const value = result as any;
    const calendars = Array.isArray(value?.calendars) ? value.calendars as { id: string; name: string; default?: boolean }[] : null;
    const weather = value?.current && value?.location && value.current.weatherCode !== undefined ? value : null;
    const air = value?.current && value?.location && value.current.us_aqi !== undefined ? value : null;
    const forecast = value?.days && value?.location ? value : null;
    const weixinState = provider === 'weixin' && typeof value?.state === 'string' ? value.state as string : undefined;
    const okText = weixinState === 'connected' ? t('connectors.connected') : weixinState ? (value?.error ? String(value.error) : t('connectors.loggedOut')) : t('connectors.testOk');
    const selectedCalendar = provider === 'outlook' ? builtin?.settings.calendarId : builtin?.settings.calendarUrl;
    return <div className="rounded-xl border border-separator bg-background/40 p-3">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-medium"><CheckCircle2 size={14} className={weixinState === 'connected' ? 'text-success' : 'text-muted'} />{okText}</p>
      {provider === 'weather' && weather && <div className="flex items-center justify-between gap-3">
        <div><p className="text-sm font-medium">{weather.location.name} · {weather.current.condition}</p><p className="mt-1 text-xs text-muted">{weather.current.temperature}°C · {t('connectors.humidity')} {weather.current.humidity}% · {t('connectors.wind')} {weather.current.windSpeed} km/h</p></div>
        <span className="text-2xl" aria-hidden="true">{weather.current.isDay ? '☀️' : '🌙'}</span>
      </div>}
      {provider === 'weather' && forecast && <div className="flex flex-col gap-1.5"><p className="text-sm font-medium">{forecast.location.name}</p>{forecast.days.slice(0, 3).map((day: any) => <div key={day.date} className="flex items-center justify-between gap-3 text-xs"><span className="text-muted">{day.date}</span><span>{day.condition}</span><span className="text-muted">{day.temperatureMin}° / {day.temperatureMax}°</span></div>)}</div>}
      {provider === 'weather' && air && <div className="grid grid-cols-3 gap-2 text-center text-xs"><div><p className="text-muted">PM2.5</p><p className="mt-1 font-medium">{air.current.pm2_5}</p></div><div><p className="text-muted">PM10</p><p className="mt-1 font-medium">{air.current.pm10}</p></div><div><p className="text-muted">AQI</p><p className="mt-1 font-medium">{air.current.us_aqi}</p></div></div>}
      {calendars && <div className="flex flex-col gap-1">
        <p className="text-xs text-muted">{t('connectors.testCalendarCount', { n: String(calendars.length) })}</p>
        {calendars.map(calendar => <button key={calendar.id} type="button" className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-xs ${selectedCalendar === calendar.id ? 'bg-default text-foreground' : 'text-muted hover:bg-default/40'}`} onClick={() => setBuiltin(current => current ? { ...current, settings: { ...current.settings, ...(current.provider === 'outlook' ? { calendarId: calendar.id } : { calendarUrl: calendar.id }), calendarName: calendar.name } } : current)}><span className="truncate">{calendar.name}</span><span className="shrink-0">{selectedCalendar === calendar.id ? t('connectors.selected') : t('connectors.calendarSelect')}</span></button>)}
      </div>}
      {provider === 'bark' && value?.ok && <p className="text-sm">{t('connectors.testNotificationSent')}</p>}
      {!weather && !forecast && !air && !calendars && !weixinState && !(provider === 'bark' && value?.ok) && <p className="text-xs text-muted">{t('connectors.testOk')}</p>}
      <details className="mt-2"><summary className="cursor-pointer text-[11px] text-muted">{t('connectors.testDetails')}</summary><pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words text-[11px] text-muted">{JSON.stringify(result, null, 2)}</pre></details>
    </div>;
  };
  const select = (label: string, value: string, options: { id: string; name: string }[], onChange: (value: string) => void) => <Select selectedKey={value} isDisabled={pending} onSelectionChange={key => { if (key !== null) onChange(String(key)); }}><Label>{label}</Label><Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger><Select.Popover><ListBox items={options}>{option => <ListBox.Item id={option.id} textValue={option.name}>{option.name}</ListBox.Item>}</ListBox></Select.Popover></Select>;
  return <div className="flex flex-col gap-8">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div><h2 className="text-2xl font-semibold tracking-tight">{t('nav.connectors')}</h2><p className="mt-1.5 text-sm text-muted">{t('connectors.desc')}</p></div>
    </header>
    {builtinError && !builtin && <Alert status="danger"><Alert.Content><Alert.Description>{builtinError}</Alert.Description></Alert.Content></Alert>}

    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">{t('connectors.connectedTitle')}</h3><span className="text-xs text-muted">{connectors.length}</span></div>
      {!connectors.length ? <div className="flex flex-col items-center gap-2 rounded-2xl border border-separator bg-surface px-6 py-10 text-center">
        <ProviderIcon />
        <p className="text-sm font-medium">{t('connectors.emptyTitle')}</p>
        <p className="max-w-sm text-xs leading-5 text-muted">{t('connectors.emptyDesc')}</p>
      </div> : <div className="overflow-hidden rounded-2xl border border-separator bg-surface">
        {connectors.map((connector, index) => {
          const isBuiltin = connector.transport === 'builtin';
          const provider = isBuiltin ? providerOf(connector.provider ?? '') : undefined;
          const connected = isBuiltin && providerConnected(provider, connector);
          const statusText = !isBuiltin ? t('connectors.customBadge') : provider?.connect ? (connected ? t('connectors.connected') : t('connectors.loggedOut')) : (connected ? t('connectors.configured') : t('connectors.loggedOut'));
          return <article key={connector.id} className={`flex min-w-0 flex-col ${index ? 'border-t border-separator' : ''}`}>
            <div className="flex min-w-0 flex-wrap items-center gap-3 px-5 py-4">
              <ProviderIcon providerId={isBuiltin ? connector.provider : 'custom'} />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <h4 className="truncate text-sm font-medium">{connector.name}</h4>
                  <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] text-muted"><span className={`size-1.5 rounded-full ${connected ? 'bg-success' : 'bg-foreground/20'}`} />{statusText}</span>
                </div>
                <p className="mt-0.5 truncate text-xs text-muted">{isBuiltin ? provider?.name ?? connector.provider : connector.transport.toUpperCase()}{connector.runtime?.error ? ` · ${connector.runtime.error}` : ''}</p>
              </div>
              <div className="flex w-full items-center justify-end gap-1 sm:ml-auto sm:w-auto sm:shrink-0">
                {isBuiltin && provider?.connect && !connected && <Button size="sm" variant="secondary" className="rounded-full" isDisabled={Boolean(busy) || builtinPending} onPress={() => openConnectorAuth(provider, connector)}><LogIn size={14} />{provider.connect.kind === 'qr' ? t('connectors.login') : t('connectors.outlookConnect')}</Button>}
                <Button size="sm" variant="ghost" className="rounded-full" isDisabled={Boolean(busy)} onPress={() => isBuiltin ? provider && openBuiltin(provider, connector) : open(connector as Connector)}><Settings2 size={14} />{t('connectors.manage')}</Button>
                <IconButton label={t('connectors.delete')} isDisabled={Boolean(busy) || builtinPending} onPress={() => { setRemoveError(''); setRemoving(connector); }}><Trash2 size={15} /></IconButton>
              </div>
            </div>
          </article>;
        })}
      </div>}
    </section>

    {catalog.length > 0 && <section id="connector-catalog" className="flex scroll-mt-6 flex-col gap-3">
      <div><h3 className="text-sm font-semibold">{t('connectors.catalogTitle')}</h3><p className="mt-0.5 text-xs text-muted">{t('connectors.catalogDesc')}</p></div>
      <div className="grid gap-2 md:grid-cols-2">
        {catalog.map(provider => <button key={provider.id} type="button" className="group flex min-w-0 items-center gap-3 rounded-xl border border-separator bg-surface px-4 py-3.5 text-left transition-colors hover:border-foreground/20 hover:bg-default/30" onClick={() => openBuiltin(provider)}>
          <ProviderIcon providerId={provider.id} />
          <div className="min-w-0 flex-1"><h4 className="truncate text-sm font-medium">{provider.name}</h4><p className="mt-0.5 line-clamp-1 text-xs text-muted">{locale === 'zh' ? provider.description : provider.descriptionEn ?? provider.description}</p></div>
          <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted transition-colors group-hover:text-foreground"><Plus size={13} />{t('connectors.choose')}</span>
        </button>)}
        <button type="button" className="group flex min-w-0 items-center gap-3 rounded-xl border border-separator bg-surface px-4 py-3.5 text-left transition-colors hover:border-foreground/20 hover:bg-default/30" onClick={() => open()}>
          <ProviderIcon providerId="custom" />
          <div className="min-w-0 flex-1"><h4 className="truncate text-sm font-medium">{t('connectors.customTitle')}</h4><p className="mt-0.5 line-clamp-1 text-xs text-muted">{t('connectors.customDesc')}</p></div>
          <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted transition-colors group-hover:text-foreground"><Plus size={13} />{t('connectors.choose')}</span>
        </button>
      </div>
    </section>}
    {draft && <Modal isOpen onOpenChange={isOpen => { if (!isOpen) close(); }}>
      <Modal.Backdrop isDismissable={!pending}><Modal.Container size="lg" scroll="inside" placement="center"><Modal.Dialog>
        <Modal.Header><div className="flex items-center justify-between"><Modal.Heading>{draft?.original ? t('connectors.edit') : t('connectors.customTitle')}</Modal.Heading><IconButton label={t('common.close')} isDisabled={pending} onPress={close}><X size={18} /></IconButton></div></Modal.Header>
        <Modal.Body>{draft && <Form id="connector-form" className="flex flex-col gap-5" validationBehavior="aria" onSubmit={event => { event.preventDefault(); void save(); }}>
          {error && <Alert status="danger"><Alert.Content><Alert.Description>{error}</Alert.Description></Alert.Content></Alert>}
          <TextField value={draft.name} isDisabled={pending} onChange={value => update('name', value)}><Label>{t('gui.name')}</Label><Input /></TextField>
          <TextField value={draft.description} isDisabled={pending} onChange={value => update('description', value)}><Label>{t('gui.description')}</Label><TextArea rows={2} /></TextField>
          <div className="grid gap-4 sm:grid-cols-2">{select(t('gui.transport'), draft.transport, ['mcp', 'command', 'http'].map(id => ({ id, name: id.toUpperCase() })), updateTransport)}{draft.transport === 'mcp' && select(t('gui.transport'), draft.remote ? 'remote' : 'stdio', [{ id: 'stdio', name: t('gui.local') }, { id: 'remote', name: t('gui.remote') }], value => update('remote', value === 'remote'))}</div>
          {draft.transport === 'http' || (draft.transport === 'mcp' && draft.remote) ? <TextField value={draft.url} isDisabled={pending} onChange={value => update('url', value)}><Label>{t('gui.url')}</Label><Input type="url" /></TextField> : <><TextField value={draft.command} isDisabled={pending} onChange={value => update('command', value)}><Label>{t('gui.executable')}</Label><Input /></TextField><ArgumentEditor value={draft.args} disabled={pending} onChange={value => update('args', value)} /></>}
          <StringMapEditor label={t('gui.environment')} value={draft.env} disabled={pending} onChange={value => update('env', value)} />
          {(draft.transport === 'http' || (draft.transport === 'mcp' && draft.remote)) && <StringMapEditor label={t('gui.headers')} value={draft.headers} disabled={pending} onChange={value => update('headers', value)} />}
          <TextField value={draft.timeout} isDisabled={pending} onChange={value => update('timeout', value)}><Label>{t('gui.timeout')}</Label><Input type="number" min={1} /></TextField>
          <section className="flex flex-col gap-4"><div className="flex items-center justify-between"><h3 className="font-medium">{t('gui.tools')}</h3><Button size="sm" variant="secondary" isDisabled={pending} onPress={() => update('tools', [...draft.tools, toolDraft({ name: '', description: '', parameters: { type: 'object', properties: {} } })])}><Plus size={14} />{t('gui.addTool')}</Button></div>
            {draft.tools.map((tool, ti) => <Card key={ti} variant="secondary"><Card.Content className="flex flex-col gap-4">
              <div className="flex items-end gap-2"><TextField className="flex-1" value={tool.name} isDisabled={pending} onChange={name => updateTool(ti, { name })}><Label>{t('gui.name')}</Label><Input /></TextField><IconButton label={t('gui.remove')} isDisabled={pending} onPress={() => update('tools', draft.tools.filter((_, i) => i !== ti))}><X size={16} /></IconButton></div>
              <TextField value={tool.description} isDisabled={pending} onChange={description => updateTool(ti, { description })}><Label>{t('gui.description')}</Label><Input /></TextField>
              <div className="flex items-center justify-between"><span className="text-sm">{t('gui.parameters')}</span><Button size="sm" variant="ghost" isDisabled={pending} onPress={() => updateTool(ti, { fields: [...tool.fields, { name: '', type: 'string', description: '', required: false, original: {} }] })}><Plus size={14} />{t('gui.addField')}</Button></div>
              {tool.fields.map((field, fi) => <div className="flex flex-col gap-2" key={fi}><div className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_auto]"><TextField value={field.name} isDisabled={pending} onChange={name => updateField(ti, fi, { name })}><Label>{t('gui.key')}</Label><Input /></TextField>{select(t('gui.fieldType'), field.type, [...new Set([...types, field.type])].map(id => ({ id, name: id })), type => updateField(ti, fi, { type }))}<IconButton label={t('gui.remove')} isDisabled={pending} onPress={() => updateTool(ti, { fields: tool.fields.filter((_, i) => i !== fi) })}><X size={16} /></IconButton></div><TextField value={field.description} isDisabled={pending} onChange={description => updateField(ti, fi, { description })}><Label>{t('gui.description')}</Label><Input /></TextField><Checkbox isSelected={field.required} isDisabled={pending} onChange={required => updateField(ti, fi, { required })}><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control><Checkbox.Content>{t('gui.required')}</Checkbox.Content></Checkbox></div>)}
            </Card.Content></Card>)}
          </section>
        </Form>}</Modal.Body>
        <Modal.Footer><Button variant="tertiary" isDisabled={pending} onPress={close}>{t('gui.cancel')}</Button><Button type="submit" form="connector-form" variant="secondary" isDisabled={Boolean(busy) || pending} isPending={pending}>{pending && <Spinner size="sm" />}{t('gui.save')}</Button></Modal.Footer>
      </Modal.Dialog></Modal.Container></Modal.Backdrop>
    </Modal>}

    {builtin && <Modal isOpen onOpenChange={open => { if (!open) closeBuiltin(); }}>
      <Modal.Backdrop isDismissable={!builtinPending}><Modal.Container size="lg" scroll="inside" placement="center"><Modal.Dialog>
        <Modal.Header><div className="flex items-center justify-between"><Modal.Heading>{auth ? (formProvider?.connect?.kind === 'qr' ? t('connectors.weixinLoginTitle') : t('connectors.outlookLoginTitle')) : formConnector ? t('connectors.editTitle', { name: formConnector.name }) : t('connectors.addTitle', { name: formProvider?.name ?? builtin.name })}</Modal.Heading><IconButton label={t('common.close')} isDisabled={builtinPending} onPress={closeBuiltin}><X size={18} /></IconButton></div></Modal.Header>
        <Modal.Body>{builtin && <div className="flex flex-col gap-4">
          {builtinError && <Alert status="danger"><Alert.Content><Alert.Description>{builtinError}</Alert.Description></Alert.Content></Alert>}
          {auth && formProvider ? <ConnectorAuth provider={formProvider} flow={auth} settings={builtin.settings} onBack={() => setAuth(null)} onConnected={completeAuth} /> : <>
            <Form id="builtin-connector-form" className="flex flex-col gap-4" onSubmit={event => { event.preventDefault(); if (!formConnector && formProvider?.connect) beginSetupAuth(); else void saveBuiltin(); }}>
              <TextField value={builtin.name} isDisabled={builtinPending} onChange={value => { setBuiltinError(''); setBuiltin(current => current ? { ...current, name: value } : current); }}><Label>{t('gui.name')}</Label><Input /></TextField>
              {formProvider?.fields.map(field => {
                if (!fieldVisible(field, builtin.settings)) return null;
                const value = field.type === 'password' ? (builtin.credentials[field.key] ?? '') : (builtin.settings[field.key] ?? '');
                if (field.type === 'bot') return <Select key={field.key} selectedKey={typeof value === 'string' ? value : ''} isDisabled={builtinPending} onSelectionChange={key => { if (key !== null) setBuiltinField(field, String(key)); }}><Label>{fieldLabel(field)}</Label><Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger><Select.Popover><ListBox items={state.bots.map(bot => ({ id: bot.id, name: `${bot.name} (${bot.id})` }))}>{option => <ListBox.Item id={option.id} textValue={option.name}>{option.name}</ListBox.Item>}</ListBox></Select.Popover>{fieldHelp(field) && <p className="text-xs text-muted">{fieldHelp(field)}</p>}</Select>;
                if (field.type === 'select') return <Select key={field.key} selectedKey={typeof value === 'string' && value ? value : String(field.defaultValue ?? field.options?.[0]?.value ?? '')} isDisabled={builtinPending} onSelectionChange={key => { if (key !== null) setBuiltinField(field, String(key)); }}><Label>{fieldLabel(field)}</Label><Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger><Select.Popover><ListBox items={(field.options ?? []).map(option => ({ id: option.value, name: option.label }))}>{option => <ListBox.Item id={option.id} textValue={option.name}>{option.name}</ListBox.Item>}</ListBox></Select.Popover>{fieldHelp(field) && <p className="text-xs text-muted">{fieldHelp(field)}</p>}</Select>;
                if (field.type === 'checkbox') return <Checkbox key={field.key} isSelected={value !== false} isDisabled={builtinPending} onChange={checked => setBuiltinField(field, checked)}><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control><Checkbox.Content>{fieldLabel(field)}</Checkbox.Content></Checkbox>;
                return <TextField key={field.key} value={String(value)} isDisabled={builtinPending} onChange={next => setBuiltinField(field, field.type === 'number' ? Number(next) : next)}><Label>{fieldLabel(field)}{field.required ? ' *' : ''}</Label><Input type={field.type === 'password' ? 'password' : field.type === 'number' ? 'number' : field.type === 'url' ? 'url' : 'text'} placeholder={field.type === 'password' && formConnector?.credentialsSet?.includes(field.key) ? t('connectors.secretSaved') : field.placeholder} autoComplete="off" /><p className="text-xs text-muted">{fieldHelp(field)}</p></TextField>;
              })}
              {testResult !== null && renderTestResult(testResult, builtin.provider)}
            </Form>
            {formConnector && formProvider?.connect && <ConnectionSection provider={formProvider} connector={formConnector} dirty={builtinDirty} busy={builtinPending} onConnect={() => setAuth({ draft: false, connectorId: formConnector.id })} onDisconnect={() => void disconnectConnector(formConnector)} />}
          </>}
        </div>}</Modal.Body>
        <Modal.Footer className="flex flex-wrap gap-2">{auth ? <Button variant="tertiary" onPress={closeBuiltin}>{t('common.close')}</Button> : <><Button variant="tertiary" isDisabled={builtinPending} onPress={closeBuiltin}>{t('gui.cancel')}</Button>{canTestForm && <Button variant="ghost" isDisabled={builtinPending} isPending={builtinPending} onPress={() => void testBuiltinDraft()}><RefreshCw size={15} />{t('connectors.test')}</Button>}{!formConnector && formProvider?.connect ? <Button type="button" variant="secondary" isDisabled={builtinPending} onPress={beginSetupAuth}><LogIn size={15} />{formProvider.connect.kind === 'qr' ? t('connectors.startScan') : t('connectors.outlookConnect')}</Button> : <Button type="submit" form="builtin-connector-form" variant="secondary" isDisabled={builtinPending} isPending={builtinPending}>{builtinPending && <Spinner size="sm" />}{t('gui.save')}</Button>}</>}</Modal.Footer>
      </Modal.Dialog></Modal.Container></Modal.Backdrop>
    </Modal>}


    <AlertDialog isOpen={Boolean(removing)} onOpenChange={open => { if (!open) setRemoving(null); }}>
      <AlertDialog.Backdrop><AlertDialog.Container><AlertDialog.Dialog>
        <AlertDialog.Header><AlertDialog.Heading>{t('connectors.deleteTitle')}</AlertDialog.Heading></AlertDialog.Header>
        <AlertDialog.Body><p>{t('connectors.deleteConfirm', { name: removing?.name ?? '' })}</p><p className="mt-2 text-xs text-muted">{t('connectors.deleteHint')}</p>{removeError && <Alert status="danger"><Alert.Content><Alert.Description>{removeError}</Alert.Description></Alert.Content></Alert>}</AlertDialog.Body>
        <AlertDialog.Footer><Button variant="tertiary" onPress={() => setRemoving(null)}>{t('common.cancel')}</Button><Button variant="danger" isPending={builtinPending} onPress={() => void removeConnector()}>{t('connectors.delete')}</Button></AlertDialog.Footer>
      </AlertDialog.Dialog></AlertDialog.Container></AlertDialog.Backdrop>
    </AlertDialog>

    <DiscardChangesDialog isOpen={discarding} onCancel={() => setDiscarding(false)} onDiscard={() => { setDiscarding(false); setDraft(null); }} />
  </div>;
}
