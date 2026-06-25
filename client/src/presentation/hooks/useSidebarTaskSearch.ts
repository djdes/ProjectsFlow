import { useEffect, useState } from 'react';
import { useContainer } from '@/infrastructure/di/container';
import type { TaskSearchResult } from '@/domain/task/TaskSearchResult';

const DEBOUNCE_MS = 220;
const MIN_LEN = 2;

// Дебаунс-поиск по задачам (title/описание) для сайдбара. Результаты отсортированы по дате
// создания — свежие сверху. Короткий/пустой запрос → пустой результат без обращения к БД.
export function useSidebarTaskSearch(query: string): {
  results: TaskSearchResult[];
  loading: boolean;
} {
  const { searchTasks } = useContainer();
  const [results, setResults] = useState<TaskSearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_LEN) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void searchTasks
        .execute(q)
        .then((res) => {
          if (cancelled) return;
          const sorted = [...res].sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          );
          setResults(sorted);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, searchTasks]);

  return { results, loading };
}
