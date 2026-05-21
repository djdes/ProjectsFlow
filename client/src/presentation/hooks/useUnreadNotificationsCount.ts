import { useCallback, useEffect, useState } from 'react';
import { useContainer } from '@/infrastructure/di/container';

// Polling-интервал. 60s — компромисс между freshness и нагрузкой. Если станет тесно
// — переехать на SSE/WS в отдельной спеке.
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
    return () => window.clearInterval(id);
  }, [refresh]);

  return { count, refresh };
}
