import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { authStatus, loadState, savedToken, storeToken } from '../lib/api';

interface AuthValue {
  /** null = 正在检查服务器鉴权要求；true = 已通过；false = 未登录 */
  authenticated: boolean | null;
  /** 服务器是否配置了 token（未配置时可直接进入并提示） */
  authRequired: boolean | null;
  token: string;
  login: (token: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState(savedToken);
  const [authRequired, setAuthRequired] = useState<boolean | null>(null);
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const required = await authStatus();
        if (cancelled) return;
        setAuthRequired(required);
        if (!required) { setVerified(true); return; }
        // 有 token 时校验有效性；无 token 或校验失败都停在登录页
        if (token) {
          try { await loadState(token); if (!cancelled) setVerified(true); }
          catch { if (!cancelled) { storeToken(''); setToken(''); setVerified(false); } }
        }
      } catch { if (!cancelled) setAuthRequired(null); }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const login = useCallback(async (input: string) => {
    const candidate = input.trim();
    if (authRequired) {
      if (!candidate) throw new Error('请输入访问令牌。');
      await loadState(candidate); // 无效 token 会抛 401
    }
    storeToken(candidate);
    setToken(candidate);
    setVerified(true);
  }, [authRequired]);

  const logout = useCallback(() => { storeToken(''); setToken(''); setVerified(false); }, []);

  const value = useMemo<AuthValue>(() => ({
    authenticated: authRequired === null ? null : verified,
    authRequired, token, login, logout,
  }), [authRequired, verified, token, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return value;
}
