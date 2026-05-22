import { useCallback, useEffect, useState } from 'react';
import { useContainer } from '@/infrastructure/di/container';
import { NOTIFICATIONS_CHANGED_EVENT } from './useNotificationStream';

// Polling-интервал — fallback на случай разрыва SSE. SSE (useNotificationStream) даёт
// мгновенный refresh через NOTIFICATIONS_CHANGED_EVENT; polling подстраховывает.
const POLL_MS = 60_000;

// Подгружает счётчик непрочитанных уведомлений с polling'ом + предоставляет refresh
// для немедленного апдейта после действий в NotificationsPage.
export function useUnreadNotificationsCount(): {
  count: number;
  refresh: () => void;
} {
  const { notificationRepository } = useContainer();
  const [count, setCount] = useState(0);

  const refresh = useCallback((): void => {
    notificationRepository
      .countUnread()
      .then(setCount)
      .catch(() => {
        /* тихо — UI не критичен, badge просто остаётся на старом значении */
      });
  }, [notificationRepository]);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, POLL_MS);
    // Мгновенный refresh при SSE-событии (новое уведомление пришло без перезагрузки).
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, refresh);
    return () => {
      window.clearInterval(id);
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, refresh);
    };
  }, [refresh]);

  return { count, refresh };
}
