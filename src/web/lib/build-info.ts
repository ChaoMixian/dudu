import { useEffect, useSyncExternalStore } from 'react';

export interface BuildInfo {
  version: string;
  build: string;
  commit?: string;
  dirty?: boolean;
  builtAt?: string;
}

interface BuildState {
  latest: BuildInfo | null;
  checking: boolean;
  error: string;
}

let state: BuildState = { latest: null, checking: false, error: '' };
const listeners = new Set<() => void>();

function update(next: Partial<BuildState>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

let inFlight: Promise<void> | null = null;

export function checkBuildInfo(): Promise<void> {
  if (inFlight) return inFlight;
  update({ checking: true });
  inFlight = fetch(`/build.json?t=${Date.now()}`, { cache: 'no-store' })
    .then(async response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const info = await response.json() as BuildInfo;
      update({ latest: info, checking: false, error: '' });
    })
    .catch(cause => {
      update({ checking: false, error: cause instanceof Error ? cause.message : String(cause) });
    })
    .finally(() => { inFlight = null; });
  return inFlight;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function hardReload() {
  const url = new URL(window.location.href);
  url.searchParams.set('v', Date.now().toString());
  window.location.replace(url.href);
}

export function useBuildInfo() {
  const snapshot = useSyncExternalStore(subscribe, () => state, () => state);
  useEffect(() => {
    if (!state.latest && !state.checking) void checkBuildInfo();
    const onVisible = () => { if (document.visibilityState === 'visible') void checkBuildInfo(); };
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(onVisible, 10 * 60_000);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, []);
  return {
    ...snapshot,
    check: checkBuildInfo,
    updateAvailable: Boolean(snapshot.latest && snapshot.latest.build !== __BUILD_ID__),
  };
}
