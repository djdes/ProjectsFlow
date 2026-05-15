import { useEffect, useState } from 'react';
import type { Project } from '@/domain/project/Project';
import { useContainer } from '@/infrastructure/di/container';
import { useProjectsContext } from './ProjectsProvider';

/**
 * Возвращает проект по id. Источник правды — общий список в ProjectsProvider:
 * это значит, что после useUpdateProject.submit() или useCreateProject.submit()
 * этот хук видит изменения мгновенно, без re-fetch.
 *
 * Если проект ещё не загружен (список пуст или редкий случай) — фоллбэк к
 * прямому getProject.execute(id).
 */
export function useProject(id: string): {
  data: Project | null;
  loading: boolean;
  notFound: boolean;
  error: Error | null;
} {
  const { getProject } = useContainer();
  const { data: list, loading: listLoading } = useProjectsContext();

  const fromList = list?.find((p) => p.id === id) ?? null;

  const [fallback, setFallback] = useState<Project | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [fetching, setFetching] = useState(false);

  // Если в списке нет проекта (и список загружен), пробуем получить точечно.
  // Это нужно для прямой ссылки на /projects/<id> когда юзер только что зашёл.
  useEffect(() => {
    if (fromList || listLoading) return;
    let cancelled = false;
    setFetching(true);
    setNotFound(false);
    setError(null);
    getProject
      .execute(id)
      .then((p) => {
        if (cancelled) return;
        if (p === null) setNotFound(true);
        else setFallback(p);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e);
      })
      .finally(() => {
        if (!cancelled) setFetching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [getProject, id, fromList, listLoading]);

  const data = fromList ?? fallback;

  return {
    data,
    loading: data === null && (listLoading || fetching) && !notFound && !error,
    notFound,
    error,
  };
}
