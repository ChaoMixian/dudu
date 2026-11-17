import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, errorText, loadState, request, streamEvents } from '../lib/api';
import { EMPTY_STATE, type AppState } from '../lib/types';
import { useAuth } from '../auth/AuthContext';

export type LiveStatus = 'connecting' | 'live' | 'reconnecting';
export interface Toast { id: number; kind: 'success' | 'error'; text: string }

interface LiveValue {
  state: AppState;
  loaded: boolean;
  live: LiveStatus;
  liveError: string;
  busy: string;
  toasts: Toast[];
  refresh: () => Promise<void>;
  /** 执行一次修改操作：成功弹通知并刷新，失败弹错误通知；返回是否成功 */
  run: (label: string, work: () => Promise<unknown>) => Promise<boolean>;
  notify: (kind: Toast['kind'], text: string) => void;
}

const LiveContext = createContext<LiveValue | null>(null);
let toastSeq = 0;

export function LiveProvider({ children }: { children: ReactNode }) {
  const { token, logout } = useAuth();
  const [state, setState] = useState<AppState>(EMPTY_STATE);
  const [loaded, setLoaded] = useState(false);
  const [live, setLive] = useState<LiveStatus>('connecting');
  const [liveError, setLiveError] = useState('');
  const [busy, setBusy] = useState('');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const busyRef = useRef(false);

  const notify = useCallback((kind: Toast['kind'], text: string) => {
    const id = ++toastSeq;
    setToasts(current => [...current, { id, kind, text }]);
    setTimeout(() => setToasts(current => current.filter(toast => toast.id !== id)), 5000);
  }, []);

  const refresh = useCallback(async () => {
    const next = await loadState(token);
    setState(next);
    setLoaded(true);
  }, [token]);

  useEffect(() => {
    const controller = new AbortController();
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    let refreshing = false;
    // Keep the current snapshot while reconnecting after the setup password
    // creates the access token; clearing it would unmount the setup route.
    setLiveError('');

    const snapshot = async () => {
      if (refreshing || controller.signal.aborted) return;
      refreshing = true;
      try { await refresh(); } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 401) { logout(); return; }
        setLiveError(errorText(error));
      } finally { refreshing = false; }
    };
    void snapshot();

    const connect = async () => {
      setLive('connecting');
      try {
        await streamEvents(token, controller.signal,
          () => { if (debounceTimer) clearTimeout(debounceTimer); debounceTimer = setTimeout(() => void snapshot(), 100); },
          () => { setLive('live'); setLiveError(''); void snapshot(); });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 401) { logout(); return; }
        setLive('reconnecting');
        setLiveError(errorText(error));
        reconnectTimer = setTimeout(() => void connect(), 3000);
      }
    };
    void connect();

    return () => { controller.abort(); clearTimeout(reconnectTimer); clearTimeout(debounceTimer); };
  }, [refresh, token, logout]);

  const run = useCallback(async (label: string, work: () => Promise<unknown>) => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(label);
    try {
      await work();
      if (label) notify('success', label);
      try { await refresh(); } catch (error) { notify('error', `操作已提交，但刷新失败：${errorText(error)}`); }
      return true;
    } catch (error) {
      notify('error', errorText(error));
      return false;
    } finally {
      busyRef.current = false;
      setBusy('');
    }
  }, [notify, refresh]);

  const value = useMemo<LiveValue>(() => ({
    state, loaded, live, liveError, busy, toasts, refresh, run, notify,
  }), [state, loaded, live, liveError, busy, toasts, refresh, run, notify]);

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveValue {
  const value = useContext(LiveContext);
  if (!value) throw new Error('useLive 必须在 LiveProvider 内使用');
  return value;
}

/** 修改操作的快捷封装：返回 (path, method, body) => Promise。 */
export function useMutate() {
  const { token } = useAuth();
  const { run } = useLive();
  return useCallback((label: string, path: string, method = 'POST', body?: unknown) =>
    run(label, () => request(token, path, method, body)), [token, run]);
}
