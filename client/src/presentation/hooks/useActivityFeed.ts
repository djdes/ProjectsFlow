import { useCallback, useEffect, useRef, useState } from 'react';
import type { FeedItem } from '@/domain/activity/ActivityFeedItem';
import type { FeedTab } from '@/application/activity/ActivityRepository';
import type { Notification } from '@/domain/notifications/Notification';
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
  patchItem: (id: string, patch: Partial<Notification>) => void;
} {
  const { getActivityFeed } = useContainer();
  const [items, setItems] = useState<FeedItem[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const seq = useRef(0);
  // Сколько строк уже загружено (с учётом «загрузить ещё») — чтобы live-рефетч перечитывал
  // РОВНО это окно, а не только первую страницу (иначе терялась подгрузка и прыгал скролл).
  const loadedCount = useRef(0);
  useEffect(() => {
    loadedCount.current = items.length;
  }, [items]);

  // Полный сброс к первой странице — начальная загрузка и смена вкладки.
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

  // Live-рефетч по realtime-событиям: перечитываем РОВНО загруженное окно (не только PAGE) и
  // заменяем тем же набором id → React переиспользует DOM, позиция скролла и «загрузить ещё»
  // сохраняются; реально новые строки просто добавятся сверху. Без loading-мигания.
  const syncWindow = useCallback(() => {
    if (!workspaceId) return;
    const s = (seq.current += 1);
    const limit = Math.max(PAGE, loadedCount.current);
    getActivityFeed
      .execute(workspaceId, { tab, limit })
      .then((page) => {
        if (s !== seq.current) return;
        setItems(page.items);
        setNextBefore(page.nextBefore);
        setError(null);
      })
      .catch(() => {
        /* live-рефетч best-effort — не роняем ленту */
      });
  }, [getActivityFeed, workspaceId, tab]);

  // Точечный in-place апдейт одного уведомления (readAt при клике/пометке) — БЕЗ рефетча,
  // чтобы клик по строке не сбрасывал ленту к первой странице и не прыгал скролл вверх.
  const patchItem = useCallback((id: string, patch: Partial<Notification>) => {
    setItems((prev) =>
      prev.map((it) =>
        it.type !== 'activity' && it.notification.id === id
          ? { ...it, notification: { ...it.notification, ...patch } }
          : it,
      ),
    );
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Live-рефетч: события задач/проектов/уведомлений долетают по существующему SSE-бусу.
  // Используем syncWindow (сохраняет окно/скролл), а НЕ refresh (тот сбрасывает к 1-й странице).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = (): void => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(syncWindow, 400);
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
  }, [syncWindow]);

  const loadMore = useCallback(() => {
    if (!workspaceId || !nextBefore) return;
    const s = seq.current; // не инкрементим — append к текущей загрузке
    getActivityFeed
      .execute(workspaceId, { tab, before: nextBefore, limit: PAGE })
      .then((page) => {
        if (s !== seq.current) return;
        // Курсор before — по createdAt (секундная гранулярность). Дедуп по id страхует
        // от повтора граничного элемента с тем же временем.
        setItems((prev) => {
          const seen = new Set(prev.map((it) => (it.type === 'activity' ? it.id : it.notification.id)));
          const fresh = page.items.filter((it) => !seen.has(it.type === 'activity' ? it.id : it.notification.id));
          return [...prev, ...fresh];
        });
        setNextBefore(page.nextBefore);
      })
      .catch(() => {
        /* подгрузка старее — best-effort, не роняем ленту */
      });
  }, [getActivityFeed, workspaceId, tab, nextBefore]);

  return { items, loading, error, hasMore: nextBefore !== null, loadMore, refresh, patchItem };
}
