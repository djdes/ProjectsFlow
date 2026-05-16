import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { User } from '@/domain/user/User';
import { useContainer } from '@/infrastructure/di/container';

type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

type AuthContextValue = {
  status: AuthStatus;
  user: User | null;
  // Принимает уже залогиненного юзера (после consume magic link на /auth/magic/consume).
  adoptUser: (user: User) => void;
  logout: () => Promise<void>;
  // Используется useUpdateProfile после успешного PATCH /auth/me
  applyUserUpdate: (next: User) => void;
};

const AuthCtx = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): React.ReactElement {
  const { authRepository } = useContainer();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<User | null>(null);

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

  const adoptUser = useCallback((next: User) => {
    setUser(next);
    setStatus('authenticated');
  }, []);

  const value: AuthContextValue = {
    status,
    user,
    adoptUser,
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
