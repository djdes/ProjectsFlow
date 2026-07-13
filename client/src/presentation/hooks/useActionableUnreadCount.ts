import { useCallback, useEffect, useState } from 'react';
import { useContainer } from '@/infrastructure/di/container';
import { NOTIFICATIONS_CHANGED_EVENT } from './useNotificationStream';

const POLL_MS = 60_000;

// Счётчик непрочитанных actionable-уведомлений (инвайты в пространство/проект, join-request) —
// для бейджа «Действие» в чат-ленте и сигнала на rail-кнопке «Чат». Делегирования сюда НЕ
// входят: с Task 14 они принимаются автоматически, уведомление о них — информационное.
// Зеркало useUnreadNotificationsCount, но через countActionableUnread. Обновляется по
// NOTIFICATIONS_CHANGED_EVENT + polling.
export function useActionableUnreadCount(): { count: number; refresh: () => void } {
  const { notificationRepository } = useContainer();
  const [count, setCount] = useState(0);

  const refresh = useCallback((): void => {
    notificationRepository
      .countActionableUnread()
      .then(setCount)
      .catch(() => {
        /* тихо — badge просто остаётся на старом значении */
      });
  }, [notificationRepository]);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, POLL_MS);
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, refresh);
    return () => {
      window.clearInterval(id);
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, refresh);
    };
  }, [refresh]);

  return { count, refresh };
}
