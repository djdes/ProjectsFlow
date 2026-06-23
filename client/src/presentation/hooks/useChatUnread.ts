import { useCallback, useEffect, useState } from 'react';
import { useContainer } from '@/infrastructure/di/container';
import { CHAT_CHANGED_EVENT } from './useNotificationStream';

// Счётчик непрочитанного в чате активного пространства → бейдж 🔴 на кнопке «Чат».
// Рефетчит при realtime-событии workspace_chat_changed (свой ws) и по запросу (refresh).
export function useChatUnread(workspaceId: string | null): { count: number; refresh: () => void } {
  const { chatRepository } = useContainer();
  const [count, setCount] = useState(0);

  const refresh = useCallback(() => {
    if (!workspaceId) {
      setCount(0);
      return;
    }
    chatRepository
      .getUnreadCount(workspaceId)
      .then(setCount)
      .catch(() => {});
  }, [workspaceId, chatRepository]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!workspaceId) return;
    const onChange = (e: Event): void => {
      const detail = (e as CustomEvent<{ workspaceId: string }>).detail;
      if (detail?.workspaceId === workspaceId) refresh();
    };
    window.addEventListener(CHAT_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(CHAT_CHANGED_EVENT, onChange);
  }, [workspaceId, refresh]);

  return { count, refresh };
}
