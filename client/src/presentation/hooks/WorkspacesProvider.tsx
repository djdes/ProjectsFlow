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

  const refresh = useCallback(() => {
    const seq = (loadSeq.current += 1);
    listWorkspaces
      .execute()
      .then((workspaces) => {
        if (seq === loadSeq.current) {
          setData(workspaces);
          setError(null);
        }
      })
      .catch((e: Error) => {
        if (seq === loadSeq.current) setError(e);
      });
  }, [listWorkspaces]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const switchTo = useCallback(
    async (id: string): Promise<void> => {
      setSwitching(true);
      // Оптимистично помечаем активным, чтобы UI среагировал мгновенно.
      setData((prev) => (prev === null ? prev : markCurrent(prev, id)));
      try {
        await workspaceRepository.switchCurrent(id);
        // Сайдбар/страницы проектов перечитываются (ProjectsProvider слушает это событие).
        window.dispatchEvent(new Event(PROJECT_CHANGED_EVENT));
      } catch (e) {
        // Ошибка — откатываем оптимистичный флаг к серверному состоянию.
        refresh();
        throw e;
      } finally {
        setSwitching(false);
      }
    },
    [workspaceRepository, refresh],
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
      // Новое пространство приходит активным — снимаем флаг с остальных.
      setData((prev) => (prev === null ? [w] : markCurrent([...prev, w], w.isCurrent ? w.id : (prev.find((x) => x.isCurrent)?.id ?? w.id))));
    },
    applyReplace: (w) => {
      setData((prev) => (prev === null ? [w] : prev.map((x) => (x.id === w.id ? { ...x, ...w } : x))));
    },
    applyRemove: (id) => {
      setData((prev) => (prev === null ? prev : prev.filter((x) => x.id !== id)));
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
