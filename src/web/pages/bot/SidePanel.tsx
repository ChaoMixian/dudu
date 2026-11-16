import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { BotConfig } from '../../../contracts';
import type { PanelKind, PanelTab, SideTab } from '../../lib/types';
import { useI18n } from '../../i18n';
import Icon, { type IconName } from '../../ui/Icon';
import IconButton from '../../ui/IconButton';
import FilesPanel from './FilesPanel';
import ComputersTab from './ComputersTab';
import SessionPanel from './SessionPanel';
import TerminalPanel from './TerminalPanel';

function iconFor(kind: PanelKind): IconName {
  return kind === 'files' ? 'folder' : kind === 'terminal' ? 'terminal' : kind === 'session' ? 'session' : kind === 'computer' ? 'monitor' : 'grid';
}

function PanelStart({ onOpen }: { onOpen: (kind: SideTab) => void }) {
  const { t } = useI18n();
  const tools: { kind: SideTab; icon: IconName; title: string; desc: string }[] = [
    { kind: 'computer', icon: 'monitor', title: t('panel.computer'), desc: t('panel.computerDesc') },
    { kind: 'files', icon: 'folder', title: t('panel.files'), desc: t('panel.filesDesc') },
    { kind: 'terminal', icon: 'terminal', title: t('panel.terminal'), desc: t('panel.terminalDesc') },
    { kind: 'session', icon: 'session', title: t('panel.session'), desc: t('panel.sessionDesc') },
  ];
  return (
    <div className="panel-start">
      <header className="panel-start-head">
        <h2>{t('panel.newTab')}</h2>
        <p>{t('panel.startHint')}</p>
      </header>
      <div className="panel-start-list">
        {tools.map(tool => (
          <button type="button" className="panel-start-item" key={tool.kind} onClick={() => onOpen(tool.kind)}>
            <span className="panel-start-icon"><Icon name={tool.icon} size={20} /></span>
            <span className="panel-start-text">
              <span className="panel-start-title">{tool.title}</span>
              <span className="panel-start-desc">{tool.desc}</span>
            </span>
            <span className="panel-start-open">{t('panel.open')}</span>
          </button>
        ))}
      </div>
      <p className="panel-start-note">{t('panel.startNote')}</p>
    </div>
  );
}

export default function SidePanel({ bot, tabs, activeId, onSelect, onCloseTab, onNewTab, onOpenTool, onTerminalPid, onClose, width, resizing }: {
  bot: BotConfig;
  tabs: PanelTab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: () => void;
  onOpenTool: (kind: SideTab) => void;
  onTerminalPid: (tabId: string, pid: number) => void;
  onClose: () => void;
  width: number;
  resizing: boolean;
}) {
  const { t } = useI18n();
  const activeRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLSpanElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [fade, setFade] = useState({ start: false, end: false });
  const [entering, setEntering] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setEntering(false), 220);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => { if (resizing || width <= 0) setEntering(false); }, [resizing, width]);

  const updateFade = () => {
    const element = tabsRef.current;
    if (!element) return;
    setFade({
      start: element.scrollLeft > 1,
      end: element.scrollLeft + element.clientWidth < element.scrollWidth - 1,
    });
  };

  const titleOf = (tab: PanelTab, index: number) => {
    const base = tab.kind === 'start' ? t('panel.newTab') : tab.kind === 'files' ? t('panel.files') : tab.kind === 'terminal' ? t('panel.terminal') : tab.kind === 'session' ? t('panel.session') : t('panel.computer');
    if (tab.kind === 'start') return base;
    const count = tabs.slice(0, index + 1).filter(item => item.kind === tab.kind).length;
    return count > 1 ? `${base} ${count}` : base;
  };
  const ageOf = (createdAt: number) => {
    const minutes = Math.max(0, Math.floor((now - createdAt) / 60_000));
    if (minutes < 1) return t('panel.justNow');
    if (minutes < 60) return t('panel.minutes', { n: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t('panel.hours', { n: hours });
    return t('panel.days', { n: Math.floor(hours / 24) });
  };
  const filtered = tabs
    .map((tab, index) => ({ tab, title: titleOf(tab, index) }))
    .filter(({ title }) => !query.trim() || title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));

  useEffect(() => {
    const active = activeRef.current;
    const strip = tabsRef.current;
    if (!active || !strip) return;
    const tabRect = active.getBoundingClientRect();
    const stripRect = strip.getBoundingClientRect();
    if (tabRect.left < stripRect.left) strip.scrollLeft -= stripRect.left - tabRect.left;
    else if (tabRect.right > stripRect.right) strip.scrollLeft += tabRect.right - stripRect.right;
    updateFade();
  }, [activeId, tabs.length]);
  useEffect(() => {
    updateFade();
    const element = tabsRef.current;
    if (!element) return;
    const observer = new ResizeObserver(updateFade);
    observer.observe(element);
    return () => observer.disconnect();
  }, [tabs.length, width]);
  useEffect(() => {
    if (!menuOpen) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [menuOpen]);
  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || menuButtonRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  return (
    <aside className="side-panel" data-entering={entering ? 'true' : undefined} data-resizing={resizing ? 'true' : undefined} style={{ '--side-width': `${width}px` } as CSSProperties} aria-label={t('panel.title')}>
      <div className="panel-bar">
        <span className="panel-tab-menu-anchor" ref={menuButtonRef}>
          <IconButton label={t('panel.tabs')} onPress={() => { setQuery(''); setMenuOpen(value => !value); }}>
            <Icon name="chevron" size={16} className="rotate-90" />
          </IconButton>
        </span>
        <div
          className="panel-tabs"
          role="tablist"
          aria-label={t('panel.title')}
          ref={tabsRef}
          data-fade-start={fade.start ? 'true' : undefined}
          data-fade-end={fade.end ? 'true' : undefined}
          onScroll={updateFade}
        >
          {tabs.map((tab, index) => {
            const active = tab.id === activeId;
            const title = titleOf(tab, index);
            return (
              <div className="panel-tab" data-active={active ? 'true' : undefined} key={tab.id} ref={active ? activeRef : undefined}>
                <button type="button" role="tab" aria-selected={active} className="panel-tab-select" title={title} onClick={() => onSelect(tab.id)}>
                  <Icon name={iconFor(tab.kind)} size={14} /><span>{title}</span>
                </button>
                <button type="button" className="panel-tab-close" aria-label={t('panel.closeTab')} onClick={() => onCloseTab(tab.id)}><Icon name="close" size={12} /></button>
              </div>
            );
          })}
        </div>
        <span className="panel-tabs-add">
          <IconButton label={t('panel.newTab')} onPress={onNewTab}><Icon name="plus" size={16} /></IconButton>
        </span>
        <div className="panel-bar-actions">
          <IconButton label={t('panel.collapse')} onPress={onClose}><Icon name="panelRight" size={16} /></IconButton>
        </div>
      </div>
      {menuOpen && (
        <div className="panel-tab-menu" ref={menuRef}>
          <div className="panel-tab-menu-search">
            <Icon name="search" size={15} />
            <input
              autoFocus
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder={t('panel.searchTabs')}
              onKeyDown={event => {
                if (event.key === 'Enter' && filtered[0]) { onSelect(filtered[0].tab.id); setMenuOpen(false); }
              }}
            />
          </div>
          <div className="panel-tab-menu-section">{t('panel.openTabs')}</div>
          <div className="panel-tab-menu-list">
            {filtered.length ? filtered.map(({ tab, title }) => (
              <div className="panel-tab-menu-item" data-active={tab.id === activeId ? 'true' : undefined} key={tab.id}>
                <button type="button" className="panel-tab-menu-select" onClick={() => { onSelect(tab.id); setMenuOpen(false); }}>
                  <Icon name={iconFor(tab.kind)} size={15} />
                  <span className="panel-tab-menu-title">{title}</span>
                  <span className="panel-tab-menu-age">{ageOf(tab.createdAt)}</span>
                </button>
                <button type="button" className="panel-tab-menu-close" aria-label={t('panel.closeTab')} onClick={() => onCloseTab(tab.id)}><Icon name="close" size={12} /></button>
              </div>
            )) : <p className="panel-tab-menu-empty">{t('panel.noTabs')}</p>}
          </div>
        </div>
      )}
      <div className="panel-views">
        {tabs.map(tab => (
          <div key={tab.id} className="panel-view" style={{ display: tab.id === activeId ? 'flex' : 'none' }}>
            {tab.kind === 'start' ? <PanelStart onOpen={onOpenTool} />
              : tab.kind === 'files' ? <FilesPanel botId={bot.id} />
              : tab.kind === 'terminal' ? <TerminalPanel bot={bot} pid={tab.terminalPid} onPid={pid => onTerminalPid(tab.id, pid)} resizing={resizing} width={width} />
              : tab.kind === 'computer' ? <ComputersTab bot={bot} />
              : <SessionPanel bot={bot} />}
          </div>
        ))}
      </div>
    </aside>
  );
}
