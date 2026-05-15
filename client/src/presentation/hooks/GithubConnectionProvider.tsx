import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { GithubConnection } from '@/domain/github/GithubConnection';
import { useContainer } from '@/infrastructure/di/container';

type GithubConnectionContextValue = {
  connection: GithubConnection | null;
  loading: boolean;
  // Используется ConnectGithubDialog после успеха device flow.
  applySet: (conn: GithubConnection) => void;
  applyClear: () => void;
};

const Ctx = createContext<GithubConnectionContextValue | null>(null);

export function GithubConnectionProvider({ children }: { children: ReactNode }): React.ReactElement {
  const { githubRepository } = useContainer();
  const [connection, setConnection] = useState<GithubConnection | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    githubRepository
      .getConnection()
      .then((c) => {
        if (!cancelled) setConnection(c);
      })
      .catch((e: unknown) => {
        console.error('[GithubConnection] /me failed:', e);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [githubRepository]);

  const value: GithubConnectionContextValue = {
    connection,
    loading,
    applySet: (c) => setConnection(c),
    applyClear: () => setConnection(null),
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useGithubConnection(): GithubConnectionContextValue {
  const c = useContext(Ctx);
  if (!c) throw new Error('useGithubConnection must be used inside <GithubConnectionProvider>');
  return c;
}
