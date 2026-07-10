import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { User } from '@/domain/user/User';
import type { LoginInput, RegisterInput } from '@/application/auth/AuthRepository';
import { useContainer } from '@/infrastructure/di/container';

type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

type AuthContextValue = {
  status: AuthStatus;
  user: User | null;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  // Используется useUpdateProfile после успешного PATCH /auth/me
  applyUserUpdate: (next: User) => void;
};

const AuthCtx = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): React.ReactElement {
  const { authRepository } = useContainer();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<User | null>(null);

  // На маунте — спрашиваем сервер «кто я?». 401 → anonymous, 200 → authenticated.
  useEffect(() => {
    let cancelled = false;
    authRepository
      .getCurrentOrNull()
      .then((u) => {
        if (cancelled) return;
        setUser(u);
        setStatus(u ? 'authenticated' : 'anonymous');
      })
      .catch((e: unknown) => {
        // Сетевая ошибка — не валим UI, считаем anonymous. Юзер сможет потом залогиниться.
        console.error('[AuthProvider] /me failed:', e);
        if (!cancelled) {
          setUser(null);
          setStatus('anonymous');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [authRepository]);

  // Сессия истекла в середине работы (httpClient поймал 401 → событие). Переводим в
  // anonymous — ProtectedRoute сам уведёт на /login с возвратом на текущий адрес.
  // Идемпотентно: повторные события ничего не ломают.
  useEffect(() => {
    const onExpired = (): void => {
      setUser(null);
      setStatus('anonymous');
    };
    window.addEventListener('pf:session-expired', onExpired);
    return () => window.removeEventListener('pf:session-expired', onExpired);
  }, []);

  const adoptUser = useCallback((next: User) => {
    setUser(next);
    setStatus('authenticated');
  }, []);

  const value: AuthContextValue = {
    status,
    user,
    login: async (input) => {
      const u = await authRepository.login(input);
      adoptUser(u);
    },
    register: async (input) => {
      const u = await authRepository.register(input);
      adoptUser(u);
    },
    logout: async () => {
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
