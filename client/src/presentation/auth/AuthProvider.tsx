import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { User } from '@/domain/user/User';
import type { LoginInput, RegisterInput } from '@/application/auth/AuthRepository';
import { useContainer } from '@/infrastructure/di/container';

type AuthStatus = 'loading' | 'authenticated' | 'anonymous' | 'unavailable';

type AuthContextValue = {
  status: AuthStatus;
  user: User | null;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  retrySession: () => Promise<void>;
  // Используется useUpdateProfile после успешного PATCH /auth/me
  applyUserUpdate: (next: User) => void;
};

const AuthCtx = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): React.ReactElement {
  const { authRepository } = useContainer();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<User | null>(null);
  const generation = useRef(0);

  const retrySession = useCallback(async (): Promise<void> => {
    const current = ++generation.current;
    setStatus('loading');
    try {
      const next = await authRepository.getCurrentOrNull();
      if (current !== generation.current) return;
      setUser(next);
      setStatus(next ? 'authenticated' : 'anonymous');
    } catch (error) {
      console.error('[AuthProvider] /me failed:', error);
      if (current === generation.current) setStatus('unavailable');
    }
  }, [authRepository]);

  // На маунте — спрашиваем сервер «кто я?». 401 → anonymous, 200 → authenticated.
  useEffect(() => {
    void retrySession();
    return () => { generation.current += 1; };
  }, [retrySession]);

  useEffect(() => {
    if (status !== 'unavailable') return;
    const recover = (): void => {
      if (navigator.onLine && document.visibilityState === 'visible') void retrySession();
    };
    window.addEventListener('online', recover);
    document.addEventListener('visibilitychange', recover);
    return () => {
      window.removeEventListener('online', recover);
      document.removeEventListener('visibilitychange', recover);
    };
  }, [status, retrySession]);

  // Сессия истекла в середине работы (httpClient поймал 401 → событие). Переводим в
  // anonymous — ProtectedRoute сам уведёт на /login с возвратом на текущий адрес.
  // Идемпотентно: повторные события ничего не ломают.
  useEffect(() => {
    const onExpired = (): void => {
      generation.current += 1;
      setUser(null);
      setStatus('anonymous');
    };
    window.addEventListener('pf:session-expired', onExpired);
    return () => window.removeEventListener('pf:session-expired', onExpired);
  }, []);

  const adoptUser = useCallback((next: User) => {
    generation.current += 1;
    setUser(next);
    setStatus('authenticated');
  }, []);

  const value: AuthContextValue = {
    status,
    user,
    retrySession,
    login: async (input) => {
      const u = await authRepository.login(input);
      adoptUser(u);
    },
    register: async (input) => {
      const u = await authRepository.register(input);
      adoptUser(u);
    },
    logout: async () => {
      generation.current += 1;
      try {
        await authRepository.logout();
      } finally {
        setUser(null);
        setStatus('anonymous');
      }
    },
    applyUserUpdate: (next) => setUser(next),
  };

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthContextValue {
  const c = useContext(AuthCtx);
  if (!c) throw new Error('useAuth must be used inside <AuthProvider>');
  return c;
}
