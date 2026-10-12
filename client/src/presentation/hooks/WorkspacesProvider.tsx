import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Workspace } from '@/domain/workspace/Workspace';
import { useContainer } from '@/infrastructure/di/container';
import { PROJECT_CHANGED_EVENT } from './useNotificationStream';
import { toast } from '@/components/ui/sonner';

type WorkspacesContextValue = {
  data: Workspace[] | null;
  loading: boolean;
  error: Error | null;
  // Активное пространство (по флагу isCurrent; fallback — первое в списке).
  current: Workspace | null;
  // Переключить активное пространство: оптимистично + сервер + рефетч проектов.
  switchTo: (id: string) => Promise<void>;
  switching: boolean;
  // Оптимистичные обновления списка.
  applyAppend: (w: Workspace) => void;
  applyReplace: (w: Workspace) => void;
  applyRemove: (id: string) => void;
  refresh: () => void;
};

const WorkspacesCtx = createContext<WorkspacesContextValue | null>(null);

// Помечает только указанное пространство активным, остальным снимает флаг.
function markCurrent(list: Workspace[], id: string): Workspace[] {
  return list.map((w) => ({ ...w, isCurrent: w.id === id }));
}

export function WorkspacesProvider({ children }: { children: ReactNode }): React.ReactElement {
  const { listWorkspaces, workspaceRepository } = useContainer();
  const [data, setData] = useState<Workspace[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [switching, setSwitching] = useState(false);
  const loadSeq = useRef(0);
  const switchSeq = useRef(0);
  const switchingRef = useRef(false);
  const switchQueue = useRef<Promise<void>>(Promise.resolve());
  const scopeRef = useRef<string | null>(null);
  const setScope = useCallback((id: string | null) => {
    scopeRef.current = id;
    workspaceRepository.setRequestWorkspace(id);
  }, [workspaceRepository]);

  const refresh = useCallback(() => {
    if (switchingRef.current) return;
    const seq = (loadSeq.current += 1);
    listWorkspaces
      .execute()
      .then((workspaces) => {
        if (seq === loadSeq.current) {
          // Background refreshes keep this tab's workspace when it is still accessible.
          // The account preference may have changed independently in another tab.
          const selected = workspaces.find((w) => w.id === scopeRef.current)
            ?? workspaces.find((w) => w.isCurrent) ?? workspaces[0];
          setScope(selected?.id ?? null);
          setData(selected ? markCurrent(workspaces, selected.id) : workspaces);
          setError(null);
        }
      })
      .catch((e: Error) => {
        if (seq === loadSeq.current) setError(e);
      });
  }, [listWorkspaces, setScope]);

  useEffect(() => {
    refresh();
    window.addEventListener(PROJECT_CHANGED_EVENT, refresh);
    return () => {
      loadSeq.current += 1;
      setScope(null);
      window.removeEventListener(PROJECT_CHANGED_EVENT, refresh);
    };
  }, [refresh, setScope]);

  const switchTo = useCallback(
    async (id: string): Promise<void> => {
      const seq = ++switchSeq.current;
      loadSeq.current += 1;
      switchingRef.current = true;
      setSwitching(true);
      toast.dismiss();
      // Serialize preference writes. A slower earlier switch cannot win on the server.
      const pending = switchQueue.current.catch(() => {}).then(() => workspaceRepository.switchCurrent(id));
      switchQueue.current = pending;
      try {
        await pending;
        if (seq !== switchSeq.current) return;
        setScope(id);
        setData((prev) => prev === null ? prev : markCurrent(prev, id));
        setError(null);
      } catch (e) {
        if (seq === switchSeq.current) {
          // A timeout may have committed remotely. Reconcile before showing any data.
          try {
            const workspaces = await listWorkspaces.execute();
            setScope((workspaces.find((w) => w.isCurrent) ?? workspaces[0])?.id ?? null);
            setData(workspaces);
          } catch (reloadError) {
            setData(null);
            setError(reloadError as Error);
          }
        }
        throw e;
      } finally {
        if (seq === switchSeq.current) {
          switchingRef.current = false;
          setSwitching(false);
        }
      }
    },
    [workspaceRepository, listWorkspaces, setScope],
  );

  const current = data?.find((w) => w.isCurrent) ?? data?.[0] ?? null;

  const value: WorkspacesContextValue = {
    data,
    loading: data === null && error === null,
    error,
    current,
    switchTo,
    switching,
    applyAppend: (w) => {
      if (w.isCurrent) setScope(w.id);
      // Новое пространство приходит активным — снимаем флаг с остальных.
      setData((prev) => (prev === null ? [w] : markCurrent([...prev, w], w.isCurrent ? w.id : (prev.find((x) => x.isCurrent)?.id ?? w.id))));
    },
    applyReplace: (w) => {
      // A settings response must not adopt another browser tab's current preference.
      const selected = scopeRef.current ?? w.id;
      setScope(selected);
      setData((prev) => {
        const next = prev === null ? [w] : prev.map((x) => x.id === w.id ? { ...x, ...w } : x);
        return markCurrent(next, selected);
      });
    },
    applyRemove: (id) => {
      if (current?.id === id) {
        // The server chooses the next accessible workspace after leaving/deleting.
        // Hide the removed workspace until that choice has been loaded.
        setScope(null);
        setData(null);
        setError(null);
        refresh();
      } else {
        setData((prev) => prev === null ? prev : prev.filter((x) => x.id !== id));
      }
    },
    refresh,
  };

  return <WorkspacesCtx.Provider value={value}>{children}</WorkspacesCtx.Provider>;
}

export function useWorkspacesContext(): WorkspacesContextValue {
  const c = useContext(WorkspacesCtx);
  if (!c) throw new Error('useWorkspacesContext must be used inside <WorkspacesProvider>');
  return c;
}
