import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Project } from '@/domain/project/Project';
import { useContainer } from '@/infrastructure/di/container';
import { PROJECT_CHANGED_EVENT, TASK_CHANGED_EVENT } from './useNotificationStream';

type ProjectsContextValue = {
  data: Project[] | null;
  loading: boolean;
  error: Error | null;
  // Добавить только что созданный проект в начало списка (оптимистичное обновление).
  applyAppend: (p: Project) => void;
  // Заменить существующий проект (после edit/update).
  applyReplace: (p: Project) => void;
  // Переставить проекты в заданном порядке id (оптимистичная сортировка). id, которых нет
  // в списке (например, inbox), сохраняют относительное положение в хвосте.
  applyReorder: (orderedIds: readonly string[]) => void;
  // Переключить favorite-флаг проекта (см. db/040). При favorite=true локально
  // ставит favoriteSortOrder = MAX(существующие favs) + 1, чтобы новый избранный
  // встал в конец секции «Избранное» — то же, что делает сервер.
  applyToggleFavorite: (projectId: string, favorite: boolean) => void;
  // Переставить favorites в заданном порядке id (только те, что isFavorite=true).
  applyReorderFavorites: (orderedIds: readonly string[]) => void;
  // Перезагрузить список с сервера (для live-обновлений по SSE и refetch-on-focus).
  refresh: () => void;
};

const ProjectsCtx = createContext<ProjectsContextValue | null>(null);

export function ProjectsProvider({ children }: { children: ReactNode }): React.ReactElement {
  const { listProjects } = useContainer();
  const [data, setData] = useState<Project[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  // Гард от гонок: учитываем результат только последней загрузки.
  const loadSeq = useRef(0);

  const refresh = useCallback(() => {
    const seq = (loadSeq.current += 1);
    listProjects
      .execute()
      .then((projects) => {
        if (seq === loadSeq.current) {
          setData(projects);
          setError(null);
        }
      })
      .catch((e: Error) => {
        if (seq === loadSeq.current) setError(e);
      });
  }, [listProjects]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Live-обновление списка: при изменении проекта (rename и т.п.) или задач (счётчик
  // taskCount в сайдбаре) перезагружаем список. Debounce коалесцирует серию событий.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = (): void => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(refresh, 400);
    };
    window.addEventListener(PROJECT_CHANGED_EVENT, schedule);
    window.addEventListener(TASK_CHANGED_EVENT, schedule);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener(PROJECT_CHANGED_EVENT, schedule);
      window.removeEventListener(TASK_CHANGED_EVENT, schedule);
    };
  }, [refresh]);

  const value: ProjectsContextValue = {
    data,
    loading: data === null && error === null,
    error,
    applyAppend: (project) => {
      setData((prev) => (prev === null ? [project] : [project, ...prev]));
    },
    applyReplace: (project) => {
      setData((prev) => (prev === null ? [project] : prev.map((p) => (p.id === project.id ? project : p))));
    },
    applyReorder: (orderedIds) => {
      setData((prev) => {
        if (prev === null) return prev;
        const byId = new Map(prev.map((p) => [p.id, p]));
        const reordered = orderedIds
          .map((id) => byId.get(id))
          .filter((p): p is Project => p !== undefined);
        const idSet = new Set(orderedIds);
        const rest = prev.filter((p) => !idSet.has(p.id));
        return [...reordered, ...rest];
      });
    },
    applyToggleFavorite: (projectId, favorite) => {
      setData((prev) => {
        if (prev === null) return prev;
        // При favorite=true: новый favoriteSortOrder = MAX(существующие) + 1. Это
        // дублирует серверную логику; на следующем refresh подтянем авторитетные значения.
        const maxFavOrder = prev
          .filter((p) => p.isFavorite)
          .reduce((max, p) => Math.max(max, p.favoriteSortOrder), -1);
        return prev.map((p) => {
          if (p.id !== projectId) return p;
          return favorite
            ? { ...p, isFavorite: true, favoriteSortOrder: maxFavOrder + 1 }
            : { ...p, isFavorite: false };
        });
      });
    },
    applyReorderFavorites: (orderedIds) => {
      setData((prev) => {
        if (prev === null) return prev;
        // Назначаем favoriteSortOrder по позиции в orderedIds; не-favorites не трогаем.
        const orderById = new Map(orderedIds.map((id, i) => [id, i] as const));
        return prev.map((p) => {
          const idx = orderById.get(p.id);
          return idx !== undefined && p.isFavorite
            ? { ...p, favoriteSortOrder: idx }
            : p;
        });
      });
    },
    refresh,
  };

  return <ProjectsCtx.Provider value={value}>{children}</ProjectsCtx.Provider>;
}

export function useProjectsContext(): ProjectsContextValue {
  const c = useContext(ProjectsCtx);
  if (!c) throw new Error('useProjectsContext must be used inside <ProjectsProvider>');
  return c;
}
