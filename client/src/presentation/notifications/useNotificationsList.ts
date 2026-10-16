import { useCallback, useEffect, useRef, useState } from 'react';
import type { Notification } from '@/domain/notifications/Notification';
import { useContainer } from '@/infrastructure/di/container';
import { NOTIFICATIONS_CHANGED_EVENT } from '@/presentation/hooks/useNotificationStream';

const PAGE = 50;
const PENDING_LIMIT = 20;

export type NotificationsFilter = 'all' | 'unread';

// Список колокольчика: сверху — неотвеченные приглашения и запросы доступа («Ждут ответа»),
// чтобы их не утопили сотни изменений задач; ниже — последние уведомления без них.
export function useNotificationsList(filter: NotificationsFilter): {
  pending: Notification[];
  items: Notification[];
  loading: boolean;
  error: boolean;
  refresh: () => void;
  patchItem: (id: string, patch: Partial<Notification>) => void;
} {
  const { notificationRepository } = useContainer();
  const [pending, setPending] = useState<Notification[]>([]);
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const seq = useRef(0);

  const refresh = useCallback((): void => {
    const s = (seq.current += 1);
    Promise.all([
      notificationRepository.list({ unreadOnly: true, limit: PENDING_LIMIT, actionableOnly: true }),
      notificationRepository.list({ unreadOnly: filter === 'unread', limit: PAGE }),
    ])
      .then(([waiting, latest]) => {
        if (s !== seq.current) return;
        const pendingIds = new Set(waiting.map((n) => n.id));
        setPending(waiting);
        setItems(latest.filter((n) => !pendingIds.has(n.id)));
        setError(false);
      })
      .catch(() => {
        if (s === seq.current) setError(true);
      })
      .finally(() => {
        if (s === seq.current) setLoading(false);
      });
  }, [notificationRepository, filter]);

  useEffect(() => {
    setLoading(true);
    refresh();
  }, [refresh]);

  // Новое уведомление (SSE) или ответ на приглашение — перечитываем без мигания загрузкой.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = (): void => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(refresh, 300);
    };
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, schedule);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, schedule);
    };
  }, [refresh]);

  const patchItem = useCallback((id: string, patch: Partial<Notification>): void => {
    const apply = (list: Notification[]): Notification[] =>
      list.map((n) => (n.id === id ? { ...n, ...patch } : n));
    setPending(apply);
    setItems(apply);
  }, []);

  return { pending, items, loading, error, refresh, patchItem };
}
