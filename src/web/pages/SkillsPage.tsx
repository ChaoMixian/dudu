import { useEffect, useRef, useState } from 'react';
import { Alert, AlertDialog, Button, EmptyState, Input, Spinner, TextField } from '@heroui/react';
import { BookOpen, Download, ExternalLink, GitBranch, Plus, Search, Trash2 } from 'lucide-react';
import { errorText, request, segment } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n';
import IconButton from '../ui/IconButton';

interface InstalledSkill { slug: string; name: string; description: string; source?: string; skillId?: string; fileCount?: number }
interface SearchSkill { id: string; name: string; source: string; skillId: string; installs: number }
interface RemoteSkill { id: string; name: string; description: string; folder: string; source: string; files: number }
interface RemoteResult { source: string; ref: string; skills: RemoteSkill[] }

const palettes = [['#f97316', '#db2777'], ['#38bdf8', '#6366f1'], ['#34d399', '#0ea5e9'], ['#fbbf24', '#f97316'], ['#a78bfa', '#ec4899'], ['#22d3ee', '#3b82f6']];

function glyph(source: string) {
  let hash = 0;
  for (const char of source) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const [from, to] = palettes[hash % palettes.length]!;
  return { background: `linear-gradient(135deg, ${from}, ${to})` };
}

function githubAvatar(source?: string): string | undefined {
  const owner = source?.split('/')[0];
  return owner && /^[A-Za-z0-9_.-]+$/.test(owner) ? `https://github.com/${owner}.png?size=80` : undefined;
}

function SkillAvatar({ source, label, small = false }: { source?: string; label: string; small?: boolean }) {
  const [failed, setFailed] = useState(false);
  const url = githubAvatar(source);
  return <div className={`relative flex shrink-0 items-center justify-center overflow-hidden text-xs font-bold text-white ${small ? 'size-8 rounded-lg' : 'size-10 rounded-xl'}`} style={glyph(source ?? label)} aria-hidden="true">
    <span>{label.slice(0, 1).toUpperCase()}</span>
    {url && !failed && <img src={url} alt="" className="absolute inset-0 size-full object-cover" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />}
  </div>;
}

function installCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(value);
}

export default function SkillsPage({ onPendingChange }: { onDirtyChange?: (dirty: boolean) => void; onPendingChange?: (pending: boolean) => void } = {}) {
  const { token } = useAuth();
  const { t } = useI18n();
  const [installed, setInstalled] = useState<InstalledSkill[]>([]);
  const [popular, setPopular] = useState<SearchSkill[]>([]);
  const [popularLimit, setPopularLimit] = useState(18);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchSkill[]>([]);
  const [searching, setSearching] = useState(false);
  const [loadingPopular, setLoadingPopular] = useState(true);
  const [source, setSource] = useState('');
  const [remote, setRemote] = useState<RemoteResult | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState<InstalledSkill | null>(null);
  const [removeError, setRemoveError] = useState('');
  const [descriptions, setDescriptions] = useState<Record<string, string>>({});
  const busyRef = useRef(false);
  const attemptedDescriptions = useRef(new Set<string>());
  const showingSearch = query.trim().length >= 2;
  const visible = showingSearch ? results : popular.slice(0, popularLimit);

  const load = async () => {
    try { const result = await request<{ skills: InstalledSkill[] }>(token, '/skills'); setInstalled(result.skills); }
    catch (cause) { setError(errorText(cause)); }
  };

  useEffect(() => {
    void load();
    const controller = new AbortController();
    setLoadingPopular(true);
    void request<{ skills: SearchSkill[] }>(token, '/skills/popular', 'GET', undefined, controller.signal)
      .then(result => setPopular(result.skills))
      .catch(cause => { if (!controller.signal.aborted) setError(errorText(cause)); })
      .finally(() => setLoadingPopular(false));
    return () => controller.abort();
  }, [token]);

  useEffect(() => { onPendingChange?.(Boolean(busy)); }, [busy, onPendingChange]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); setSearching(false); return; }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSearching(true);
      void request<{ skills: SearchSkill[] }>(token, `/skills/search?q=${encodeURIComponent(q)}`, 'GET', undefined, controller.signal)
        .then(result => setResults(result.skills.slice(0, 24)))
        .catch(cause => { if (!controller.signal.aborted) setError(errorText(cause)); })
        .finally(() => { if (!controller.signal.aborted) setSearching(false); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, token]);

  useEffect(() => {
    const missing = visible.map(skill => skill.id).filter(skillId => descriptions[skillId] === undefined && !attemptedDescriptions.current.has(skillId));
    if (!missing.length) return;
    for (const skillId of missing) attemptedDescriptions.current.add(skillId);
    const timer = setTimeout(() => {
      void request<{ descriptions: Record<string, string> }>(token, '/skills/describe', 'POST', { ids: missing })
        .then(result => setDescriptions(current => ({ ...current, ...result.descriptions })))
        .catch(() => {});
    }, 100);
    return () => clearTimeout(timer);
  }, [visible.map(skill => skill.id).join('|'), token, descriptions]);

  const installedMatch = (skill: SearchSkill) => installed.some(item => item.source === skill.source && (item.name === skill.name || item.slug === skill.skillId || item.skillId?.split('/').pop() === skill.skillId));
  const inspect = async () => {
    if (!source.trim() || busyRef.current) return;
    setBusy('inspect'); setError(''); setRemote(null);
    try { setRemote(await request<RemoteResult>(token, '/skills/inspect', 'POST', { source: source.trim() })); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(''); }
  };
  const install = async (input: string, skillId?: string) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(skillId ?? input); setError('');
    try { await request(token, '/skills/install', 'POST', { source: input, ...(skillId ? { skillId } : {}) }); setRemote(null); await load(); }
    catch (cause) { setError(errorText(cause)); }
    finally { busyRef.current = false; setBusy(''); }
  };
  const remove = async () => {
    if (!removing || busyRef.current) return;
    busyRef.current = true; setBusy(removing.slug); setRemoveError('');
    try { await request(token, `/skills/${segment(removing.slug)}`, 'DELETE'); setRemoving(null); await load(); }
    catch (cause) { setRemoveError(errorText(cause)); }
    finally { busyRef.current = false; setBusy(''); }
  };

  return <div className="flex flex-col gap-6">
    <header><h2 className="text-2xl font-semibold tracking-tight">{t('skills.title')}</h2><p className="mt-1.5 text-sm text-muted">{t('skills.desc')}</p></header>
    {error && <Alert status="danger"><Alert.Content><Alert.Description>{error}</Alert.Description></Alert.Content></Alert>}

    <section className="flex flex-col gap-3 rounded-2xl border border-separator bg-surface px-5 py-4">
      <div><h3 className="text-sm font-semibold">{t('skills.repoTitle')}</h3><p className="mt-0.5 text-xs text-muted">{t('skills.repoHint')}</p></div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <TextField className="flex-1" value={source} onChange={setSource}><Input placeholder="https://github.com/owner/repo" autoComplete="off" /></TextField>
        <Button variant="secondary" className="rounded-full" isDisabled={Boolean(busy) || !source.trim()} isPending={busy === 'inspect'} onPress={() => void inspect()}><GitBranch size={16} />{t('skills.inspect')}</Button>
      </div>
      {remote && <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3"><p className="text-xs text-muted">{remote.source} · {remote.ref}</p><span className="text-xs text-muted">{remote.skills.length}</span></div>
        {!remote.skills.length && <p className="text-xs text-muted">{t('skills.noSkills')}</p>}
        {remote.skills.map(skill => <div key={skill.id} className="flex items-center gap-3 rounded-xl border border-separator px-3 py-2">
          <SkillAvatar source={skill.source} label={skill.name} small />
          <div className="min-w-0 flex-1"><h4 className="truncate text-sm font-medium">{skill.name}</h4><p className="mt-0.5 line-clamp-2 text-xs text-muted">{skill.description || skill.folder || skill.id}</p></div>
          <Button size="sm" variant="secondary" isDisabled={Boolean(busy)} isPending={busy === skill.id} onPress={() => void install(remote.source, skill.id)}><Download size={14} />{t('skills.install')}</Button>
        </div>)}
      </div>}
    </section>

    <section className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-3"><div><h3 className="text-sm font-semibold">{t('skills.installedTitle')}</h3><p className="mt-0.5 text-xs text-muted">{t('skills.installedHint')}</p></div><span className="text-xs text-muted">{installed.length}</span></div>
      {!installed.length && <EmptyState className="rounded-2xl border border-separator bg-surface px-6 py-10"><div className="flex flex-col items-center gap-3 text-center"><div className="provider-glyph" aria-hidden="true"><BookOpen size={22} /></div><p className="text-sm font-medium">{t('skills.emptyTitle')}</p><p className="max-w-sm text-xs leading-5 text-muted">{t('skills.emptyDesc')}</p><Button size="sm" variant="secondary" className="rounded-full" onPress={() => document.getElementById('skills-discover')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>{t('skills.browse')}</Button></div></EmptyState>}
      {installed.length > 0 && <div className="overflow-hidden rounded-2xl border border-separator bg-surface">
        {installed.map((skill, index) => <article key={skill.slug} className={`flex min-w-0 items-center gap-4 px-5 py-4 ${index ? 'border-t border-separator' : ''}`}>
          <SkillAvatar source={skill.source} label={skill.name ?? skill.slug} />
          <div className="min-w-0 flex-1"><h4 className="truncate text-[15px] font-semibold tracking-tight">{skill.name}</h4><p className="mt-0.5 line-clamp-2 text-xs text-muted">{skill.description}</p><p className="mt-1 truncate text-[11px] text-muted">{skill.source ?? t('skills.local')}{skill.fileCount ? ` · ${skill.fileCount} ${t('skills.files')}` : ''}</p></div>
          <IconButton label={t('skills.remove')} isDisabled={Boolean(busy)} onPress={() => { setRemoveError(''); setRemoving(skill); }}><Trash2 size={16} /></IconButton>
        </article>)}
      </div>}
    </section>

    <section id="skills-discover" className="flex flex-col gap-4 scroll-mt-6 rounded-2xl border border-separator bg-surface px-5 py-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t('skills.discoverTitle')}</h3>
        <span className="rounded-full bg-default px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide text-muted">skills.sh</span>
      </div>
      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-muted" aria-hidden="true" />
        <TextField value={query} onChange={setQuery}><Input className="pl-9" placeholder={t('skills.searchPlaceholder')} autoComplete="off" /></TextField>
      </div>
      {showingSearch && <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold">{t('skills.results')}</h4>
        {searching && <span className="inline-flex items-center gap-1.5 text-xs text-muted"><Spinner size="sm" />{t('skills.searching')}</span>}
      </div>}
      {!showingSearch && loadingPopular && <div className="flex items-center gap-1.5 text-xs text-muted"><Spinner size="sm" />{t('skills.loadingPopular')}</div>}
      {!visible.length && !searching && !loadingPopular && <p className="rounded-xl border border-dashed border-separator px-4 py-8 text-center text-xs text-muted">{showingSearch ? t('skills.noResults') : t('skills.noPopular')}</p>}
      {visible.length > 0 && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map(skill => {
          const done = installedMatch(skill);
          return <article key={skill.id} className="group flex min-h-36 flex-col gap-3 rounded-2xl border border-separator bg-background/40 p-4 transition hover:border-foreground/20 hover:bg-background/60">
            <div className="flex items-start gap-3">
              <SkillAvatar source={skill.source} label={skill.name} />
              <div className="min-w-0 flex-1"><h5 className="truncate text-sm font-semibold tracking-tight">{skill.name}</h5><p className="mt-0.5 truncate text-[11px] text-muted">{skill.source}</p></div>
              <IconButton label={t('skills.openPage')} onPress={() => window.open(`https://skills.sh/${skill.id}`, '_blank', 'noopener,noreferrer')}><ExternalLink size={14} /></IconButton>
            </div>
            <p className="line-clamp-3 min-h-8 text-xs leading-5 text-muted">{descriptions[skill.id] || t('skills.loadingDescription')}</p>
            <div className="mt-auto flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1 text-[11px] text-muted"><Download size={12} />{t('skills.installs', { n: installCount(skill.installs) })}</span>
              <Button size="sm" variant={done ? 'tertiary' : 'secondary'} className="rounded-full" isDisabled={done || Boolean(busy)} isPending={busy === skill.skillId} onPress={() => void install(skill.source, skill.skillId)}>{done ? t('skills.installedBadge') : t('skills.install')}</Button>
            </div>
          </article>;
        })}
      </div>}
      {!showingSearch && popular.length > popularLimit && <div className="flex justify-center"><Button variant="secondary" className="rounded-full" onPress={() => setPopularLimit(limit => limit + 18)}><Plus size={15} />{t('skills.loadMore')}</Button></div>}
      {!showingSearch && popular.length > 0 && popular.length <= popularLimit && <div className="flex justify-end"><Button variant="ghost" size="sm" className="rounded-full" onPress={() => window.open('https://skills.sh', '_blank', 'noopener,noreferrer')}><ExternalLink size={14} />{t('skills.viewAll')}</Button></div>}
    </section>

    <AlertDialog isOpen={Boolean(removing)} onOpenChange={open => { if (!open) setRemoving(null); }}>
      <AlertDialog.Backdrop><AlertDialog.Container><AlertDialog.Dialog>
        <AlertDialog.Header><AlertDialog.Heading>{t('skills.removeTitle')}</AlertDialog.Heading></AlertDialog.Header>
        <AlertDialog.Body><p>{t('skills.removeConfirm', { name: removing?.name ?? '' })}</p>{removeError && <Alert status="danger"><Alert.Content><Alert.Description>{removeError}</Alert.Description></Alert.Content></Alert>}</AlertDialog.Body>
        <AlertDialog.Footer><Button variant="tertiary" onPress={() => setRemoving(null)}>{t('common.cancel')}</Button><Button variant="danger" isPending={busy === removing?.slug} onPress={() => void remove()}>{t('skills.remove')}</Button></AlertDialog.Footer>
      </AlertDialog.Dialog></AlertDialog.Container></AlertDialog.Backdrop>
    </AlertDialog>
  </div>;
}
