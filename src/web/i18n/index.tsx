import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { zh, type Dictionary } from './zh';
import { en } from './en';

export type Locale = 'zh' | 'en';
const dictionaries: Record<Locale, Dictionary> = { zh, en };
const STORAGE_KEY = 'dudu.locale';
const DEFAULT_LOCALE: Locale = 'zh';

/** 把嵌套字典键扁平化为 'a.b.c' 字面量联合 */
type Flatten<T, Prefix extends string = ''> = T extends string
  ? never
  : { [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : Flatten<T[K], `${Prefix}${K}.`> }[keyof T & string];
export type TKey = Flatten<Dictionary>;

function resolve(dictionary: Dictionary, key: string): string {
  let node: unknown = dictionary;
  for (const part of key.split('.')) {
    if (node === undefined || typeof node !== 'object') return key;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : key;
}

export type TFunction = (key: TKey, params?: Record<string, string | number>) => string;

interface I18nValue { locale: Locale; setLocale: (locale: Locale) => void; t: TFunction }

const I18nContext = createContext<I18nValue | null>(null);

function detectLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'zh' || stored === 'en') return stored;
  } catch { /* ignore */ }
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : DEFAULT_LOCALE;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale);

  useEffect(() => {
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
  }, []);

  const t = useCallback<TFunction>((key, params) => {
    let text = resolve(dictionaries[locale], key) || resolve(zh, key);
    if (params) for (const [name, value] of Object.entries(params)) text = text.replaceAll(`{${name}}`, String(value));
    return text;
  }, [locale]);

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside I18nProvider');
  return value;
}
