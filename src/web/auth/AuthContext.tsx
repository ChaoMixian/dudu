import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { authStatus, errorText, loadState, loginWithPassword, savedToken, storeToken } from '../lib/api';

interface AuthValue {
  /** null = 正在检查服务器鉴权要求；true = 已通过；false = 未登录 */
  authenticated: boolean | null;
  /** 服务器是否要求鉴权（token 或访问密码） */
  authRequired: boolean | null;
  /** 无法读取鉴权状态时的错误；非空时页面应显示错误态而不是登录页。 */
  authError: string;
  token: string;
  login: (password: string) => Promise<void>;
  /** Adopt the access token returned by the first-run setup. */
  adopt: (token: string) => void;
  retry: () => void;
  logout: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState(savedToken);
  const [authRequired, setAuthRequired] = useState<boolean | null>(null);
  const [authError, setAuthError] = useState('');
  const [verified, setVerified] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const required = await authStatus();
        if (cancelled) return;
        setAuthError('');
        setAuthRequired(required);
        if (!required) { setVerified(true); return; }
        // 有 token 时校验有效性；无 token 或校验失败都停在登录页
        if (token) {
          try { await loadState(token); if (!cancelled) setVerified(true); }
          catch { if (!cancelled) { storeToken(''); setToken(''); setVerified(false); } }
        }
      } catch (cause) {
        if (!cancelled) { setAuthError(errorText(cause)); setAuthRequired(null); }
      }
    })();
    return () => { cancelled = true; };
  }, [token, attempt]);

  const login = useCallback(async (input: string) => {
    const password = input.trim();
    if (!password) throw new Error('请输入访问密码。');
    const accessToken = await loginWithPassword(password);
    if (accessToken) { storeToken(accessToken); setToken(accessToken); setVerified(true); setAuthRequired(true); }
    else { storeToken(''); setToken(''); setVerified(true); setAuthRequired(false); }
  }, []);

  const adopt = useCallback((accessToken: string) => {
    storeToken(accessToken);
    setToken(accessToken);
    setVerified(Boolean(accessToken));
    setAuthRequired(Boolean(accessToken));
  }, []);

  const retry = useCallback(() => setAttempt(value => value + 1), []);

  const logout = useCallback(() => { storeToken(''); setToken(''); setVerified(false); }, []);

  const value = useMemo<AuthValue>(() => ({
    authenticated: authRequired === null ? null : verified,
    authRequired, authError, token, login, adopt, retry, logout,
  }), [authRequired, authError, verified, token, login, adopt, retry, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return value;
}
