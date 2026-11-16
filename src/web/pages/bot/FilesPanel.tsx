import { lazy, Suspense, useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { AlertDialog, Button, Spinner } from '@heroui/react';
import type { WorkspaceEntry } from '../../../contracts';
import { useAuth } from '../../auth/AuthContext';
import { useI18n } from '../../i18n';
import { useLive } from '../../state/LiveContext';
import { deleteWorkspacePath, errorText, listWorkspace, mkdirWorkspacePath, uploadWorkspaceFiles, workspaceBlob } from '../../lib/api';
import { formatBytes } from '../../lib/format';
import { TEXT_PREVIEW_LIMIT, previewKind } from '../../lib/preview';
import Icon, { type IconName } from '../../ui/Icon';
import IconButton from '../../ui/IconButton';

const MonacoViewer = lazy(() => import('../../ui/MonacoViewer'));

const MAX_PREVIEW_BYTES = 20 * 1024 * 1024;
const LIST_MIN = 150;
const LIST_DEFAULT = 240;

function readListWidth(): number {
  try {
    const raw = localStorage.getItem('dudu.files.width');
    if (raw !== null) {
      const value = Number(raw);
      if (Number.isFinite(value)) return Math.max(LIST_MIN, Math.min(360, value));
    }
  } catch { /* ignore */ }
  return LIST_DEFAULT;
}

type Preview = { loading: boolean; url?: string; text?: string; error?: string; tooLarge?: boolean };
type OpenFile = { path: string; entry: WorkspaceEntry; pinned: boolean };

function parentOf(path: string): string {
  return path.split('/').slice(0, -1).join('/');
}

function monacoLanguage(name: string): string {
  const lower = name.toLowerCase();
  if (/\.(ts|tsx|mts|cts)$/.test(lower)) return 'typescript';
  if (/\.(js|jsx|mjs|cjs)$/.test(lower)) return 'javascript';
  if (/\.(json|jsonl)$/.test(lower)) return 'json';
  if (/\.(md|mdx)$/.test(lower)) return 'markdown';
  if (/\.ya?ml$/.test(lower)) return 'yaml';
  if (/\.toml$/.test(lower)) return 'ini';
  if (/\.(sh|bash|zsh)$/.test(lower)) return 'shell';
  if (/\.py$/.test(lower)) return 'python';
  if (/\.(css|scss|less)$/.test(lower)) return 'css';
  if (/\.html?$/.test(lower)) return 'html';
  if (/\.(c|h|cc|cpp|hpp)$/.test(lower)) return 'cpp';
  if (/\.rs$/.test(lower)) return 'rust';
  if (/\.go$/.test(lower)) return 'go';
  if (/\.java$/.test(lower)) return 'java';
  if (/\.sql$/.test(lower)) return 'sql';
  if (/\.xml$/.test(lower)) return 'xml';
  return 'plaintext';
}

function fileVisual(entry: WorkspaceEntry): { icon: IconName; tone: string } {
  if (entry.type === 'dir') return { icon: 'folder', tone: 'file-tone-folder' };
  if (entry.type === 'symlink') return { icon: 'link', tone: 'file-tone-muted' };
  const name = entry.name.toLowerCase();
  if (name === 'dockerfile' || name.startsWith('dockerfile') || name === '.dockerignore' || name.startsWith('docker-compose')) return { icon: 'container', tone: 'file-tone-blue' };
  if (name === '.gitignore' || name === '.gitattributes' || name === '.gitmodules') return { icon: 'gitBranch', tone: 'file-tone-orange' };
  if (name.startsWith('.env')) return { icon: 'hash', tone: 'file-tone-yellow' };
  if (/\.(ts|tsx|mts|cts)$/.test(name)) return { icon: 'fileCode', tone: 'file-tone-blue' };
  if (/\.(js|jsx|mjs|cjs)$/.test(name)) return { icon: 'fileCode', tone: 'file-tone-yellow' };
  if (/\.(json|jsonl)$/.test(name)) return { icon: 'braces', tone: 'file-tone-orange' };
  if (/\.(md|mdx)$/.test(name)) return { icon: 'file', tone: 'file-tone-green' };
  if (/\.(ya?ml|toml)$/.test(name)) return { icon: 'settings', tone: 'file-tone-purple' };
  if (/\.(sh|bash|zsh)$/.test(name)) return { icon: 'terminal', tone: 'file-tone-green' };
  if (/\.py$/.test(name)) return { icon: 'fileCode', tone: 'file-tone-blue' };
  if (/\.(html|css|scss)$/.test(name)) return { icon: 'fileCode', tone: 'file-tone-pink' };
  if (/\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/.test(name)) return { icon: 'image', tone: 'file-tone-pink' };
  if (/\.pdf$/.test(name)) return { icon: 'file', tone: 'file-tone-red' };
  if (/\.(zip|tar|gz|tgz|7z|rar)$/.test(name)) return { icon: 'fileArchive', tone: 'file-tone-yellow' };
  return { icon: 'file', tone: 'file-tone-muted' };
}

export default function FilesPanel({ botId }: { botId: string }) {
  const { token } = useAuth();
  const { t } = useI18n();
  const { notify } = useLive();
  const [root, setRoot] = useState<WorkspaceEntry[]>([]);
  const [children, setChildren] = useState<Record<string, WorkspaceEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [sourceMode, setSourceMode] = useState(false);
  const [selectedDir, setSelectedDir] = useState('work');
  const [preview, setPreview] = useState<Preview>({ loading: false });
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceEntry | null>(null);
  const [listWidth, setListWidth] = useState(readListWidth);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const selected = openFiles.find(file => file.path === activePath)?.entry ?? null;
  const isMarkdown = Boolean(selected && /\.(md|mdx)$/i.test(selected.name));

  const load = useCallback(async (path: string) => {
    setLoading(current => new Set(current).add(path));
    try {
      const entries = await listWorkspace(token, botId, path);
      if (path) setChildren(current => ({ ...current, [path]: entries }));
      else setRoot(entries);
      setError('');
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoading(current => {
        const next = new Set(current);
        next.delete(path);
        return next;
      });
    }
  }, [botId, token]);

  useEffect(() => { void load(''); }, [load]);

  const refresh = () => {
    void load('');
    for (const path of expanded) void load(path);
  };

  const toggleDir = (entry: WorkspaceEntry) => {
    setSelectedDir(entry.path);
    const open = expanded.has(entry.path);
    setExpanded(current => {
      const next = new Set(current);
      if (open) next.delete(entry.path);
      else next.add(entry.path);
      return next;
    });
    if (!open) void load(entry.path);
  };

  const openFile = (entry: WorkspaceEntry, pinned: boolean) => {
    setSelectedDir(parentOf(entry.path) || 'work');
    setOpenFiles(current => {
      const existing = current.findIndex(file => file.path === entry.path);
      if (existing >= 0) {
        return current.map((file, index) => index === existing ? { ...file, entry, pinned: file.pinned || pinned } : file);
      }
      if (!pinned) {
        const preview = current.findIndex(file => !file.pinned);
        if (preview >= 0) return current.map((file, index) => index === preview ? { path: entry.path, entry, pinned: false } : file);
      }
      return [...current, { path: entry.path, entry, pinned }];
    });
    setActivePath(entry.path);
  };

  const closeFile = (path: string) => {
    const index = openFiles.findIndex(file => file.path === path);
    if (index < 0) return;
    const next = openFiles.filter(file => file.path !== path);
    setOpenFiles(next);
    if (activePath === path) setActivePath(next[Math.min(index, next.length - 1)]?.path ?? null);
  };

  useEffect(() => { setSourceMode(false); }, [activePath]);

  const maxListWidth = () => {
    const total = panelRef.current?.clientWidth ?? 0;
    // Before the panel has been laid out, keep the stored/default width instead of clamping to the minimum.
    return total > 0 ? Math.max(LIST_MIN, Math.min(360, total - 180)) : LIST_DEFAULT;
  };
  const clampListWidth = (value: number) => Math.max(LIST_MIN, Math.min(maxListWidth(), value));
  const startListResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = listWidth;
    let nextWidth = startWidth;
    const move = (moveEvent: PointerEvent) => {
      nextWidth = clampListWidth(startWidth + startX - moveEvent.clientX);
      setListWidth(nextWidth);
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try { localStorage.setItem('dudu.files.width', String(nextWidth)); } catch { /* ignore */ }
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  };
  const resizeListKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const next = clampListWidth(listWidth + (event.key === 'ArrowLeft' ? 24 : -24));
    setListWidth(next);
    try { localStorage.setItem('dudu.files.width', String(next)); } catch { /* ignore */ }
  };
  const resetListWidth = () => {
    setListWidth(LIST_DEFAULT);
    try { localStorage.setItem('dudu.files.width', String(LIST_DEFAULT)); } catch { /* ignore */ }
  };

  useEffect(() => {
    const element = panelRef.current;
    if (!element) return;
    setListWidth(current => clampListWidth(current));
    const observer = new ResizeObserver(() => setListWidth(current => clampListWidth(current)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!selected) return;
    let objectUrl: string | undefined;
    let cancelled = false;
    const controller = new AbortController();
    const kind = previewKind(selected.mime);
    if (selected.size > MAX_PREVIEW_BYTES) {
      setPreview({ loading: false, tooLarge: true });
      return () => controller.abort();
    }
    setPreview({ loading: true });
    void workspaceBlob(token, botId, selected.path, controller.signal).then(async blob => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      if (kind === 'text') {
        const text = await blob.text();
        if (cancelled) return;
        setPreview({ loading: false, url: objectUrl, text: `${text.slice(0, TEXT_PREVIEW_LIMIT)}${text.length > TEXT_PREVIEW_LIMIT ? '\n…' : ''}` });
      } else {
        setPreview({ loading: false, url: objectUrl });
      }
    }).catch(cause => {
      if (!cancelled) setPreview({ loading: false, error: errorText(cause) });
    });
    return () => {
      cancelled = true;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [botId, selected, token]);

  const download = async (entry: WorkspaceEntry) => {
    try {
      const blob = await workspaceBlob(token, botId, entry.path);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = entry.name;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      notify('error', errorText(cause));
    }
  };

  const upload = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length) return;
    setUploading(true);
    setError('');
    try {
      const target = selectedDir || 'work';
      await uploadWorkspaceFiles(token, botId, target, list);
      notify('success', t('files.uploaded'));
      setExpanded(current => new Set(current).add(target));
      await load(target);
      if (target === 'work' || target === 'artifacts') await load('');
    } catch (cause) {
      const message = errorText(cause);
      setError(message);
      notify('error', message);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const createFolder = async () => {
    const name = folderName.trim();
    if (!name || name.includes('/') || name.includes('\\')) {
      setError(t('files.nameRequired'));
      return;
    }
    const parent = selectedDir || 'work';
    try {
      await mkdirWorkspacePath(token, botId, `${parent}/${name}`);
      notify('success', t('files.folderCreated'));
      setCreating(false);
      setFolderName('');
      setExpanded(current => new Set(current).add(parent));
      await load(parent);
      if (parent === 'work' || parent === 'artifacts') await load('');
    } catch (cause) {
      setError(errorText(cause));
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    try {
      await deleteWorkspacePath(token, botId, target.path, target.type === 'dir');
      notify('success', t('files.deleted'));
      const remaining = openFiles.filter(file => file.path !== target.path && !file.path.startsWith(`${target.path}/`));
      if (remaining.length !== openFiles.length) {
        setOpenFiles(remaining);
        if (activePath && !remaining.some(file => file.path === activePath)) setActivePath(remaining.at(-1)?.path ?? null);
      }
      setExpanded(current => {
        const next = new Set([...current].filter(path => path !== target.path && !path.startsWith(`${target.path}/`)));
        return next;
      });
      setChildren(current => {
        const next = { ...current };
        delete next[target.path];
        return next;
      });
      const parent = parentOf(target.path);
      if (parent) await load(parent);
      else await load('');
      setSelectedDir(parent || 'work');
    } catch (cause) {
      setError(errorText(cause));
      notify('error', errorText(cause));
    } finally {
      setDeleteTarget(null);
    }
  };

  const renderEntries = (entries: WorkspaceEntry[], depth = 0): ReactNode => entries.map(entry => {
    const dir = entry.type === 'dir';
    const open = expanded.has(entry.path);
    const busy = loading.has(entry.path);
    const current = dir && selectedDir === entry.path;
    const active = selected?.path === entry.path;
    const canDelete = entry.path !== 'work' && entry.path !== 'artifacts';
    const visual = fileVisual(entry);
    return (
      <div key={entry.path}>
        <div className="file-row" data-selected={active || current ? 'true' : undefined} style={{ paddingLeft: 6 + depth * 13 }}>
          <button
            type="button"
            className="file-row-main"
            onClick={event => {
              if (event.detail > 1) return;
              if (dir) toggleDir(entry);
              else openFile(entry, false);
            }}
            onDoubleClick={() => { if (!dir) openFile(entry, true); }}
          >
            <span className="file-row-caret">
              {busy ? <Spinner size="sm" /> : dir ? <Icon name="chevron" size={13} className={open ? 'rotate-90' : ''} /> : null}
            </span>
            <span className={`file-row-icon ${visual.tone}`}><Icon name={visual.icon} size={15} /></span>
            <span className="file-row-name" title={entry.path}>{entry.name}</span>
            {!dir && <span className="file-row-meta">{formatBytes(entry.size)}</span>}
          </button>
          {canDelete && (
            <button type="button" className="file-row-action" aria-label={t('files.delete')} onClick={event => { event.stopPropagation(); setDeleteTarget(entry); }}>
              <Icon name="trash" size={13} />
            </button>
          )}
        </div>
        {dir && open && <div>{renderEntries(children[entry.path] ?? [], depth + 1)}</div>}
      </div>
    );
  });

  const kind = selected ? previewKind(selected.mime) : 'file';
  return (
    <div className="files-panel" ref={panelRef}>
      <div className="files-preview-pane">
        {openFiles.length > 0 && (
          <div className="files-editor-tabs">
            <div className="files-editor-tab-list" role="tablist" aria-label={t('panel.files')}>
              {openFiles.map(file => {
                const visual = fileVisual(file.entry);
                const active = file.path === activePath;
                return (
                  <div className="files-editor-tab" data-active={active ? 'true' : undefined} data-preview={file.pinned ? undefined : 'true'} key={file.path}>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={active}
                      className="files-editor-tab-select"
                      title={`${file.path}${file.pinned ? '' : ` · ${t('files.openHint')}`}`}
                      onClick={() => setActivePath(file.path)}
                    >
                      <span className={`file-row-icon ${visual.tone}`}><Icon name={visual.icon} size={13} /></span>
                      <span className="files-editor-tab-name">{file.entry.name}</span>
                    </button>
                    <button type="button" className="files-editor-tab-close" aria-label={t('files.closeFile')} onClick={() => closeFile(file.path)}><Icon name="close" size={11} /></button>
                  </div>
                );
              })}
            </div>
            <div className="files-editor-tab-actions">
              {selected && <IconButton label={t('files.download')} onPress={() => void download(selected)}><Icon name="download" size={14} /></IconButton>}
              {selected && isMarkdown && <IconButton label={sourceMode ? t('files.rendered') : t('files.source')} onPress={() => setSourceMode(value => !value)}><Icon name={sourceMode ? 'file' : 'fileCode'} size={14} /></IconButton>}
            </div>
          </div>
        )}
        {selected ? (
          <div className="file-preview" aria-label={t('files.preview')}>
            {preview.loading && <div className="file-preview-loading"><Spinner size="sm" /></div>}
            {preview.error && <p className="file-preview-error" role="alert">{preview.error}</p>}
            {preview.tooLarge && <p className="file-preview-error">{t('files.tooLarge')}</p>}
            {!preview.loading && !preview.error && !preview.tooLarge && preview.url && kind === 'image' && <img className="file-preview-image" src={preview.url} alt={selected.name} />}
            {!preview.loading && !preview.error && !preview.tooLarge && preview.url && kind === 'video' && <video className="file-preview-video" src={preview.url} controls playsInline preload="metadata" />}
            {!preview.loading && !preview.error && !preview.tooLarge && preview.url && kind === 'audio' && <audio className="file-preview-audio" src={preview.url} controls preload="metadata" />}
            {!preview.loading && !preview.error && !preview.tooLarge && preview.url && kind === 'pdf' && <iframe className="file-preview-pdf" src={preview.url} title={selected.name} />}
            {!preview.loading && !preview.error && !preview.tooLarge && preview.text !== undefined && (isMarkdown && !sourceMode
              ? <div className="chat-markdown file-preview-markdown"><Markdown remarkPlugins={[remarkGfm, remarkBreaks]}>{preview.text}</Markdown></div>
              : <Suspense fallback={<div className="file-preview-loading"><Spinner size="sm" /></div>}><MonacoViewer value={preview.text} language={monacoLanguage(selected.name)} /></Suspense>)}
            {!preview.loading && !preview.error && !preview.tooLarge && kind === 'file' && <p className="files-empty">{t('files.noPreview')}</p>}
          </div>
        ) : (
          <div className="files-preview-empty">
            <Icon name="file" size={26} />
            <p>{t('files.selectPreview')}</p>
          </div>
        )}
        {selected && (
          <div className="files-editor-status">
            <span className="files-editor-path" title={selected.path}>{selected.path}</span>
            <span>{formatBytes(selected.size)}</span>
          </div>
        )}
      </div>
      <div
        className="files-splitter"
        role="separator"
        aria-orientation="vertical"
        aria-label={t('files.resizeList')}
        aria-valuemin={LIST_MIN}
        aria-valuemax={maxListWidth()}
        aria-valuenow={listWidth}
        tabIndex={0}
        onPointerDown={startListResize}
        onKeyDown={resizeListKey}
        onDoubleClick={resetListWidth}
      />
      <div className="files-list-pane" style={{ width: listWidth }}>
        <div className="files-toolbar">
          <div className="files-location" title={selectedDir || 'work'}><Icon name="folder" size={14} /><span>{selectedDir || 'work'}</span></div>
          <div className="files-toolbar-actions">
            <IconButton label={t('files.refresh')} onPress={refresh}><Icon name="refresh" size={15} /></IconButton>
            <IconButton label={t('files.newFolder')} onPress={() => setCreating(value => !value)}><Icon name="folderPlus" size={15} /></IconButton>
            <IconButton label={t('files.upload')} isDisabled={uploading} onPress={() => inputRef.current?.click()}>
              {uploading ? <Spinner size="sm" /> : <Icon name="upload" size={15} />}
            </IconButton>
            <input ref={inputRef} type="file" multiple hidden onChange={event => { if (event.target.files) void upload(event.target.files); }} />
          </div>
        </div>
        {creating && (
          <form className="files-new-folder" onSubmit={event => { event.preventDefault(); void createFolder(); }}>
            <input value={folderName} onChange={event => setFolderName(event.target.value)} placeholder={t('files.folderName')} autoFocus />
            <Button size="sm" type="submit" variant="primary">{t('files.create')}</Button>
            <Button size="sm" type="button" variant="ghost" onPress={() => { setCreating(false); setFolderName(''); }}>{t('common.cancel')}</Button>
          </form>
        )}
        {error && <p className="files-error" role="alert">{error}</p>}
        <div className="file-tree">
          {loading.has('') && !root.length
            ? <div className="files-loading"><Spinner size="sm" /></div>
            : root.length
              ? renderEntries(root)
              : <p className="files-empty">{t('files.empty')}</p>}
        </div>
      </div>
      <AlertDialog isOpen={Boolean(deleteTarget)} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <AlertDialog.Backdrop><AlertDialog.Container><AlertDialog.Dialog>
          <AlertDialog.Header><AlertDialog.Heading>{t('files.delete')}</AlertDialog.Heading></AlertDialog.Header>
          <AlertDialog.Body>{deleteTarget ? t('files.deleteConfirm', { name: deleteTarget.name }) : ''}</AlertDialog.Body>
          <AlertDialog.Footer>
            <Button variant="tertiary" onPress={() => setDeleteTarget(null)}>{t('common.cancel')}</Button>
            <Button variant="danger" onPress={() => void remove()}>{t('files.delete')}</Button>
          </AlertDialog.Footer>
        </AlertDialog.Dialog></AlertDialog.Container></AlertDialog.Backdrop>
      </AlertDialog>
    </div>
  );
}
