import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  checkBackendHealth,
  clearStoredToken,
  getMe,
  getStoredToken,
  login as apiLogin,
  type AuthUser,
} from '../services/backendApi';

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  backendOnline: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]           = useState<AuthUser | null>(null);
  const [loading, setLoading]     = useState(true);
  const [backendOnline, setBackendOnline] = useState(false);

  const logout = useCallback(() => {
    clearStoredToken();
    setUser(null);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await apiLogin(username, password);
    setUser({ username: res.username, role: res.role });
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const online = await checkBackendHealth();
      if (cancelled) return;
      setBackendOnline(online);

      const token = getStoredToken();
      if (!token || !online) {
        setLoading(false);
        return;
      }

      try {
        const me = await getMe();
        if (!cancelled) setUser(me);
      } catch {
        clearStoredToken();
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    init();
    return () => { cancelled = true; };
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, backendOnline, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
