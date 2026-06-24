import { useCallback, useEffect, useRef, useState } from 'react';
import type { FeedItem } from '@/domain/activity/ActivityFeedItem';
import type { FeedTab } from '@/application/activity/ActivityRepository';
import { useContainer } from '@/infrastructure/di/container';
import {
  NOTIFICATIONS_CHANGED_EVENT,
  PROJECT_CHANGED_EVENT,
  TASK_CHANGED_EVENT,
} from './useNotificationStream';

const PAGE = 30;

// Лента активности пространства для вкладок «Все» (tab='all') и «Требуется действие»
// (tab='action'). Подгрузка старее по курсору + live-рефетч по realtime-событиям.
export function useActivityFeed(
  workspaceId: string | null,
  tab: FeedTab,
): {
  items: FeedItem[];
  loading: boolean;
  error: Error | null;
  hasMore: boolean;
  loadMore: () => void;
  refresh: () => void;
} {
  const { getActivityFeed } = useContainer();
  const [items, setItems] = useState<FeedItem[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const seq = useRef(0);

  const refresh = useCallback(() => {
    if (!workspaceId) {
      setItems([]);
      setLoading(false);
      return;
    }
    const s = (seq.current += 1);
    setLoading(true);
    getActivityFeed
      .execute(workspaceId, { tab, limit: PAGE })
      .then((page) => {
        if (s !== seq.current) return;
        setItems(page.items);
        setNextBefore(page.nextBefore);
        setError(null);
      })
      .catch((e: Error) => {
        if (s === seq.current) setError(e);
      })
      .finally(() => {
        if (s === seq.current) setLoading(false);
      });
  }, [getActivityFeed, workspaceId, tab]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Live-рефетч: события задач/проектов/уведомлений долетают по существующему SSE-бусу.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = (): void => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(refresh, 400);
    };
    window.addEventListener(TASK_CHANGED_EVENT, schedule);
    window.addEventListener(PROJECT_CHANGED_EVENT, schedule);
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, schedule);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener(TASK_CHANGED_EVENT, schedule);
      window.removeEventListener(PROJECT_CHANGED_EVENT, schedule);
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, schedule);
    };
  }, [refresh]);

  const loadMore = useCallback(() => {
    if (!workspaceId || !nextBefore) return;
    const s = seq.current; // не инкрементим — append к текущей загрузке
    getActivityFeed
      .execute(workspaceId, { tab, before: nextBefore, limit: PAGE })
      .then((page) => {
        if (s !== seq.current) return;
        setItems((prev) => [...prev, ...page.items]);
        setNextBefore(page.nextBefore);
      })
      .catch(() => {
        /* подгрузка старее — best-effort, не роняем ленту */
      });
  }, [getActivityFeed, workspaceId, tab, nextBefore]);

  return { items, loading, error, hasMore: nextBefore !== null, loadMore, refresh };
}
