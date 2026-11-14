import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';
const STORAGE_KEY = 'dudu.theme';
const media = () => window.matchMedia('(prefers-color-scheme: dark)');

export function readTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {}
  return 'system';
}

export function resolvedTheme(mode: ThemeMode): 'light' | 'dark' {
  return mode === 'system' ? (media().matches ? 'dark' : 'light') : mode;
}

export function applyTheme(mode: ThemeMode): 'light' | 'dark' {
  const resolved = resolvedTheme(mode);
  document.documentElement.classList.toggle('dark', resolved === 'dark');
  document.documentElement.classList.toggle('light', resolved === 'light');
  document.documentElement.style.colorScheme = resolved;
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.setAttribute('content', resolved === 'dark' ? '#0E1012' : '#F6F4F1');
  const statusBar = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
  if (statusBar) statusBar.setAttribute('content', resolved === 'dark' ? 'black-translucent' : 'default');
  return resolved;
}

interface ThemeValue { mode: ThemeMode; resolved: 'light' | 'dark'; setMode: (mode: ThemeMode) => void }
const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(readTheme);
  const [resolved, setResolved] = useState<'light' | 'dark'>(() => resolvedTheme(mode));

  useEffect(() => {
    setResolved(applyTheme(mode));
    try { localStorage.setItem(STORAGE_KEY, mode); } catch {}
    if (mode !== 'system') return;
    const listener = () => setResolved(applyTheme(mode));
    media().addEventListener('change', listener);
    return () => media().removeEventListener('change', listener);
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => setModeState(next), []);
  const value = useMemo(() => ({ mode, resolved, setMode }), [mode, resolved, setMode]);
  return createElement(ThemeContext.Provider, { value }, children);
}

export function useThemeMode(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useThemeMode must be used inside ThemeProvider');
  return value;
}
