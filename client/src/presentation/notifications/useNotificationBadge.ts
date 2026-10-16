import { useCallback, useEffect, useState } from 'react';
import { useContainer } from '@/infrastructure/di/container';
import { useCurrentWorkspace } from '@/presentation/hooks/useCurrentWorkspace';
import { NOTIFICATIONS_CHANGED_EVENT } from '@/presentation/hooks/useNotificationStream';

const SEEN_KEY = 'pf_notifications_seen_at';
const SEEN_EVENT = 'pf:notifications-seen';
const SCOPE_KEY = 'pf_notifications_scope';

// «Для меня» — личное и задачи, где я исполнитель или автор; «Все» — ещё и всё, что приходит
// лиду по проектам. По умолчанию «Для меня»: по нему ориентируются, «Все» — посмотреть общую картину.
export type NotificationScope = 'mine' | 'all';

export function readNotificationScope(): NotificationScope {
  try {
    return localStorage.getItem(SCOPE_KEY) === 'all' ? 'all' : 'mine';
  } catch {
    return 'mine';
  }
}

// Бейдж считает в том же режиме, что выбран в колокольчике.
export function saveNotificationScope(scope: NotificationScope): void {
  try {
    localStorage.setItem(SCOPE_KEY, scope);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(SEEN_EVENT));
}
const POLL_MS = 60_000;

// Когда человек последний раз открывал колокольчик (на этом устройстве). Первый запуск
// отсчитывает от «сейчас»: копившиеся месяцами непрочитанные — не новость, а «99+»
// с первого дня читалось бы как шум. Приглашения считаются всё равно (см. сервер).
function readSeenAt(): Date {
  const now = new Date();
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    const at = raw ? new Date(raw) : null;
    if (at && Number.isFinite(at.getTime())) return at;
    localStorage.setItem(SEEN_KEY, now.toISOString());
  } catch {
    /* localStorage недоступен — считаем только приглашения и совсем свежее */
  }
  return now;
}

export function markNotificationsSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, new Date().toISOString());
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(SEEN_EVENT));
}

// Бейдж колокольчика: уведомления, пришедшие после прошлого открытия, плюс приглашения
// и запросы доступа, на которые ещё не ответили. Гаснет при открытии колокольчика. В режиме
// «Для меня» не считает то, что лиду приходит по чужим задачам.
export function useNotificationBadge(): number {
  const { notificationRepository } = useContainer();
  const { workspace } = useCurrentWorkspace();
  const workspaceId = workspace?.id ?? null;
  const [count, setCount] = useState(0);

  const refresh = useCallback((): void => {
    if (!workspaceId) return;
    notificationRepository
      .countUnread({ since: readSeenAt(), mineOnly: readNotificationScope() === 'mine' })
      .then(setCount)
      .catch(() => {
        /* тихо — бейдж остаётся на старом значении */
      });
  }, [notificationRepository, workspaceId]);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, POLL_MS);
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, refresh);
    window.addEventListener(SEEN_EVENT, refresh);
    return () => {
      window.clearInterval(id);
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, refresh);
      window.removeEventListener(SEEN_EVENT, refresh);
    };
  }, [refresh]);

  return count;
}
