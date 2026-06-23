import { useCallback, useEffect, useState } from 'react';
import type { RecentTaskView } from '@/domain/recent/RecentTaskView';
import { useContainer } from '@/infrastructure/di/container';

// Загрузчик «недавно открытых задач» текущего юзера. Рефетч по:
//  - событию 'pf:recent-changed' (TaskDrawer шлёт его после записи открытия),
//  - возврату фокуса на вкладку (мог открывать задачи на другом устройстве).
export function useRecentTasks(limit: number): {
  items: RecentTaskView[];
  loading: boolean;
  refresh: () => void;
} {
  const { listRecentTaskViews } = useContainer();
  const [items, setItems] = useState<RecentTaskView[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback((): void => {
    void listRecentTaskViews
      .execute(limit)
      .then((list) => setItems(list))
      .catch(() => {
        /* тихо: блок «Недавнее» не критичен, не шумим тостами */
      })
      .finally(() => setLoading(false));
  }, [listRecentTaskViews, limit]);

  useEffect(() => {
    refresh();
    const onChanged = (): void => refresh();
    window.addEventListener('pf:recent-changed', onChanged);
    window.addEventListener('focus', onChanged);
    return () => {
      window.removeEventListener('pf:recent-changed', onChanged);
      window.removeEventListener('focus', onChanged);
    };
  }, [refresh]);

  return { items, loading, refresh };
}
