import { useCallback, useEffect, useState } from 'react';
import { useContainer } from '@/infrastructure/di/container';
import type { ChatRoom } from '@/domain/chat/ChatRoom';
import { CHAT_CHANGED_EVENT } from './useNotificationStream';

export type UseChatRoomsResult = {
  rooms: ChatRoom[];
  totalUnread: number;
  loading: boolean;
  refresh: () => void;
};

// Чат-комнаты текущего юзера (все пространства, где он участник и есть команда/сообщения).
// Источник для вкладки «Чат» (какую комнату показать/выбрать) и для бейджа «Чат» в рейле
// (суммарный непрочитанный). Рефетчит при realtime-событии чата (любая комната) — так
// приглашённый получает обновление по хабу владельца, в котором он состоит.
export function useChatRooms(): UseChatRoomsResult {
  const { chatRepository } = useContainer();
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    chatRepository
      .listRooms()
      .then(setRooms)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [chatRepository]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const onChange = (): void => refresh();
    window.addEventListener(CHAT_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(CHAT_CHANGED_EVENT, onChange);
  }, [refresh]);

  const totalUnread = rooms.reduce((sum, r) => sum + r.unreadCount, 0);
  return { rooms, totalUnread, loading, refresh };
}
