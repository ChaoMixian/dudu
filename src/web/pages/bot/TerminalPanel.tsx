import { useEffect, useRef, useState } from 'react';
import { Spinner } from '@heroui/react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { BotConfig } from '../../../contracts';
import { useAuth } from '../../auth/AuthContext';
import { useI18n } from '../../i18n';
import { errorText, request, segment } from '../../lib/api';

type Status = 'connecting' | 'ready' | 'error' | 'closed';

/** Resolve a CSS variable in the canvas color space so xterm can parse it. */
function colorOf(property: string, fallback: string): string {
  const probe = document.createElement('div');
  probe.style.color = `var(${property})`;
  probe.style.display = 'none';
  document.body.appendChild(probe);
  const raw = getComputedStyle(probe).color;
  probe.remove();
  const context = document.createElement('canvas').getContext('2d');
  if (!context) return fallback;
  context.fillStyle = '#000';
  context.fillStyle = raw;
  return typeof context.fillStyle === 'string' ? context.fillStyle : fallback;
}

function terminalTheme() {
  const background = colorOf('--surface', '#111111');
  const foreground = colorOf('--foreground', '#eeeeee');
  const cursor = colorOf('--accent', '#6bb6b0');
  return { background, foreground, cursor, cursorAccent: background, selectionBackground: foreground };
}

export default function TerminalPanel({ bot, pid, onPid, resizing, width }: { bot: BotConfig; pid?: number; onPid: (pid: number) => void; resizing: boolean; width: number }) {
  const { token } = useAuth();
  const { t } = useI18n();
  const hostRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sendSizeRef = useRef<(() => void) | null>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const [error, setError] = useState('');
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let socket: WebSocket | undefined;
    let offData: { dispose(): void } | undefined;
    let connectTimer: number | undefined;
    let connecting = false;
    const terminal = new Terminal({
      fontSize: 12,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      cursorBlink: true,
      scrollback: 5000,
      theme: terminalTheme(),
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    fitRef.current = fit;
    terminal.open(host);
    setStatus('connecting');
    setError('');
    const sendSize = () => {
      if (socket?.readyState === WebSocket.OPEN && terminal.cols > 0 && terminal.rows > 0) {
        socket.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }));
      }
    };
    sendSizeRef.current = sendSize;
    let resizeTimer: number | undefined;
    const observer = new ResizeObserver(() => {
      if (!host.clientWidth || !host.clientHeight) return;
      if (resizeTimer !== undefined) window.clearTimeout(resizeTimer);
      // Debounce while dragging the panel/window so the PTY settles once.
      resizeTimer = window.setTimeout(() => {
        try { fit.fit(); } catch { /* keep the current grid */ }
        sendSize();
      }, 120);
      if (!socket && !connecting) {
        window.clearTimeout(connectTimer);
        startConnect();
      }
    });
    const themeObserver = new MutationObserver(() => { terminal.options.theme = terminalTheme(); });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    const connect = async () => {
      if (cancelled || connecting || socket) return;
      connecting = true;
      try {
        try { fit.fit(); } catch { /* use the default grid */ }
        const cols = Math.min(500, Math.max(20, terminal.cols || 100));
        const rows = Math.min(200, Math.max(5, terminal.rows || 30));
        const created = await request<{ ticket: string; pid: number }>(token, `/bots/${segment(bot.id)}/terminal`, 'POST', { cols, rows, ...(pid ? { pid } : {}) });
        if (cancelled) return;
        onPid(created.pid);
        const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
        socket = new WebSocket(`${scheme}://${location.host}/api/bots/${segment(bot.id)}/terminal/ws?ticket=${encodeURIComponent(created.ticket)}`);
        socket.onopen = () => sendSize();
        socket.onmessage = event => {
          try {
            const message = JSON.parse(String(event.data)) as { type?: string; data?: string };
            if (message.type === 'output' && typeof message.data === 'string') terminal.write(message.data);
            if (message.type === 'ready') { setStatus('ready'); terminal.focus(); sendSize(); }
          } catch { /* ignore malformed frames */ }
        };
        socket.onerror = () => { if (!cancelled) setStatus('error'); };
        socket.onclose = () => { if (!cancelled) setStatus(current => current === 'ready' ? 'closed' : 'error'); };
        offData = terminal.onData(data => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'input', data })); });
      } catch (cause) {
        if (cancelled) return;
        setStatus('error');
        setError(errorText(cause));
      } finally {
        connecting = false;
      }
    };

    let lastWidth = -1;
    let stableSamples = 0;
    const startConnect = () => {
      if (cancelled || connecting || socket) return;
      const currentWidth = host.clientWidth;
      if (!currentWidth || !host.clientHeight) {
        // Hidden tabs stay mounted so their terminal survives tab switches, but
        // they must not keep polling for a size that will never arrive.
        lastWidth = currentWidth;
        stableSamples = 0;
        return;
      }
      if (Math.abs(currentWidth - lastWidth) <= 1) stableSamples += 1;
      else { lastWidth = currentWidth; stableSamples = 0; }
      if (stableSamples >= 2) { void connect(); return; }
      connectTimer = window.setTimeout(startConnect, 100);
    };
    connectTimer = window.setTimeout(startConnect, 0);
    observer.observe(host);

    return () => {
      cancelled = true;
      observer.disconnect();
      themeObserver.disconnect();
      window.clearTimeout(connectTimer);
      if (resizeTimer !== undefined) window.clearTimeout(resizeTimer);
      fitRef.current = null;
      sendSizeRef.current = null;
      offData?.dispose();
      try { socket?.close(); } catch { /* already closed */ }
      terminal.dispose();
    };
  }, [bot.id, generation, token]);

  useEffect(() => {
    if (resizing) return;
    const timer = window.setTimeout(() => {
      try { fitRef.current?.fit(); } catch { /* keep the current grid */ }
      sendSizeRef.current?.();
    }, 240);
    return () => window.clearTimeout(timer);
  }, [resizing, width]);

  return (
    <div className="terminal-panel">
      {status !== 'ready' && (
        <div className="terminal-notice" data-state={status}>
          {status === 'connecting' && <Spinner size="sm" />}
          <span className="terminal-notice-text">
            {status === 'connecting' ? t('terminal.connecting') : status === 'closed' ? t('terminal.closed') : t('terminal.error')}
            {error && <span className="terminal-notice-error">{error}</span>}
          </span>
          {status !== 'connecting' && (
            <button type="button" className="terminal-reconnect" onClick={() => setGeneration(value => value + 1)}>{t('terminal.reconnect')}</button>
          )}
        </div>
      )}
      <div className="terminal-host" ref={hostRef} />
    </div>
  );
}
