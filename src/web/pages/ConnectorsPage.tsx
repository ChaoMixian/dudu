import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Checkbox, EmptyState, Form, Input, Label, ListBox, Modal, Select, Spinner, TextArea, TextField } from '@heroui/react';
import { Pencil, Plug, Plus, X } from 'lucide-react';
import type { ConnectorDefinition, ConnectorTool } from '../../contracts';
import { errorText, request } from '../lib/api';
import { useI18n } from '../i18n';
import { useAuth } from '../auth/AuthContext';
import { useLive } from '../state/LiveContext';
import ArgumentEditor from '../ui/ArgumentEditor';
import StringMapEditor, { entriesMap, mapEntries, type StringEntry } from '../ui/StringMapEditor';
import DiscardChangesDialog from '../ui/DiscardChangesDialog';
import IconButton from '../ui/IconButton';

type Connector = ConnectorDefinition & { headers?: Record<string, string>; timeoutMs?: number };
type Schema = Record<string, unknown>;
type Parameter = { name: string; type: string; description: string; required: boolean; original: Schema };
type ToolDraft = { name: string; description: string; fields: Parameter[]; original: ConnectorTool };
type Draft = { id: string; name: string; description: string; transport: Connector['transport']; remote: boolean; url: string; command: string; args: string[]; env: StringEntry[]; headers: StringEntry[]; timeout: string; tools: ToolDraft[]; original?: Connector };
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
  const { state, busy, run } = useLive();
  const { token } = useAuth();
  const { t } = useI18n();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [baseline, setBaseline] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [discarding, setDiscarding] = useState(false);
  const connectors = state.connectors.filter(connector => connector.id !== 'computer');
  const dirty = Boolean(draft && JSON.stringify(draft) !== baseline);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { onPendingChange?.(pending); }, [pending, onPendingChange]);
  const saveAutoStart = (autoStart: boolean) => {
    void run(t('connectors.saveComputer'), () => request(token, '/computer-settings', 'PUT', { autoStart }));
  };
  const open = (connector?: Connector) => { const next = makeDraft(connector); setDraft(next); setBaseline(JSON.stringify(next)); setError(''); };
  const close = () => { if (pendingRef.current) return; if (dirty) setDiscarding(true); else setDraft(null); };
  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(current => current ? { ...current, [key]: value } : current);
  const updateTool = (index: number, value: Partial<ToolDraft>) => { if (draft) update('tools', draft.tools.map((tool, i) => i === index ? { ...tool, ...value } : tool)); };
  const updateField = (toolIndex: number, fieldIndex: number, value: Partial<Parameter>) => {
    const tool = draft?.tools[toolIndex]; if (tool) updateTool(toolIndex, { fields: tool.fields.map((field, i) => i === fieldIndex ? { ...field, ...value } : field) });
  };
  const save = async () => {
    if (!draft || busy || pendingRef.current) return;
    setError('');
    let body: Connector;
    try {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(draft.id)) throw new Error(t('gui.invalidId'));
      if (!draft.name.trim()) throw new Error(t('form.nameRequired'));
      const live = state.connectors.find(connector => connector.id === draft.id);
      if (!draft.original && live) throw new Error(t('connectors.duplicateId', { id: draft.id }));
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
      body = { ...draft.original, id: draft.id, name: draft.name.trim(), description: draft.description, transport: draft.transport, tools, env: entriesMap(draft.env), headers: entriesMap(draft.headers), timeoutMs: draft.timeout ? Number(draft.timeout) : undefined };
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
  const select = (label: string, value: string, options: { id: string; name: string }[], onChange: (value: string) => void) => <Select selectedKey={value} isDisabled={pending} onSelectionChange={key => { if (key !== null) onChange(String(key)); }}><Label>{label}</Label><Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger><Select.Popover><ListBox items={options}>{option => <ListBox.Item id={option.id} textValue={option.name}>{option.name}</ListBox.Item>}</ListBox></Select.Popover></Select>;
  return <div className="flex flex-col gap-6">
    <header className="flex flex-wrap items-end justify-between gap-4"><div><h2 className="text-2xl font-semibold tracking-tight">{t('nav.connectors')}</h2><p className="mt-1.5 text-sm text-muted">{t('connectors.desc')}</p></div><Button className="rounded-full" variant="secondary" isDisabled={Boolean(busy)} onPress={() => open()}><Plus size={16} />{t('connectors.register')}</Button></header>
    <section className="flex flex-col gap-2 rounded-2xl border border-separator bg-surface px-5 py-4 sm:flex-row sm:items-center sm:justify-between" aria-label={t('connectors.computerTitle')}>
      <div className="min-w-0"><h3 className="text-sm font-semibold">{t('connectors.computerTitle')}</h3><p className="mt-0.5 text-xs text-muted">{t('connectors.computerDesc')}</p><p className="mt-0.5 text-xs text-muted">{t('connectors.autoStartHint')}</p></div>
      <div className="flex shrink-0 items-center gap-3">
        <Checkbox isSelected={state.autoStartComputers !== false} isDisabled={Boolean(busy)} onChange={saveAutoStart}>
          <Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>
          <Checkbox.Content>{t('connectors.autoStart')}</Checkbox.Content>
        </Checkbox>
        <span className="rounded-full border border-separator px-3 py-1 text-xs text-muted">{t('gui.builtin')}</span>
      </div>
    </section>
    {!connectors.length && <EmptyState className="rounded-2xl border border-separator bg-surface px-6 py-14"><p>{t('connectors.none')}</p></EmptyState>}
    {connectors.length > 0 && <div className="overflow-hidden rounded-2xl border border-separator bg-surface">
      {connectors.map((connector, index) => <article key={connector.id} className={`flex min-w-0 items-center gap-4 px-5 py-4 ${index ? 'border-t border-separator' : ''}`}>
        <div className="provider-glyph" aria-hidden="true"><Plug size={18} /></div>
        <div className="min-w-0 flex-1"><h3 className="truncate text-[15px] font-semibold tracking-tight">{connector.name}</h3><p className="mt-0.5 truncate text-xs text-muted">{connector.transport.toUpperCase()} · {connector.tools.length} {t('gui.tools')}</p></div>
        <Button variant="ghost" size="sm" className="rounded-full" isDisabled={Boolean(busy) || connector.id === 'computer'} onPress={() => open(connector as Connector)}><Pencil size={15} />{connector.id === 'computer' ? t('gui.builtin') : t('gui.edit')}</Button>
      </article>)}
    </div>}
    <Modal isOpen={Boolean(draft)} onOpenChange={isOpen => { if (!isOpen) close(); }}>
      <Modal.Backdrop isDismissable={!pending}><Modal.Container size="lg" scroll="inside" placement="center"><Modal.Dialog>
        <Modal.Header><div className="flex items-center justify-between"><Modal.Heading>{draft?.original ? t('connectors.edit') : t('connectors.register')}</Modal.Heading><IconButton label={t('common.close')} isDisabled={pending} onPress={close}><X size={18} /></IconButton></div></Modal.Header>
        <Modal.Body>{draft && <Form id="connector-form" className="flex flex-col gap-5" validationBehavior="aria" onSubmit={event => { event.preventDefault(); void save(); }}>
          {error && <Alert status="danger"><Alert.Content><Alert.Description>{error}</Alert.Description></Alert.Content></Alert>}
          <div className="grid gap-4 sm:grid-cols-2"><TextField value={draft.id} isReadOnly={Boolean(draft.original)} isDisabled={pending} onChange={value => update('id', value)}><Label>{t('gui.id')}</Label><Input /></TextField><TextField value={draft.name} isDisabled={pending} onChange={value => update('name', value)}><Label>{t('gui.name')}</Label><Input /></TextField></div>
          <TextField value={draft.description} isDisabled={pending} onChange={value => update('description', value)}><Label>{t('gui.description')}</Label><TextArea rows={2} /></TextField>
          <div className="grid gap-4 sm:grid-cols-2">{select(t('gui.transport'), draft.transport, ['mcp', 'command', 'http'].map(id => ({ id, name: id.toUpperCase() })), value => update('transport', value as Draft['transport']))}{draft.transport === 'mcp' && select(t('gui.transport'), draft.remote ? 'remote' : 'local', [{ id: 'local', name: t('gui.local') }, { id: 'remote', name: t('gui.remote') }], value => update('remote', value === 'remote'))}</div>
          {draft.transport === 'http' || (draft.transport === 'mcp' && draft.remote) ? <TextField value={draft.url} isDisabled={pending} onChange={value => update('url', value)}><Label>{t('gui.url')}</Label><Input type="url" /></TextField> : <><TextField value={draft.command} isDisabled={pending} onChange={value => update('command', value)}><Label>{t('gui.executable')}</Label><Input /></TextField><ArgumentEditor value={draft.args} disabled={pending} onChange={value => update('args', value)} /></>}
          <StringMapEditor label={t('gui.environment')} value={draft.env} disabled={pending} onChange={value => update('env', value)} />
          {(draft.transport === 'http' || draft.remote) && <StringMapEditor label={t('gui.headers')} value={draft.headers} disabled={pending} onChange={value => update('headers', value)} />}
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
    </Modal>
    <DiscardChangesDialog isOpen={discarding} onCancel={() => setDiscarding(false)} onDiscard={() => { setDiscarding(false); setDraft(null); }} />
  </div>;
}
