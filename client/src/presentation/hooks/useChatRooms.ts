import { useCallback, useEffect, useState } from 'react';
import { useContainer } from '@/infrastructure/di/container';
import type { ChatRoom } from '@/domain/chat/ChatRoom';
import { CHAT_CHANGED_EVENT } from './useNotificationStream';
import { useCurrentWorkspace } from './useCurrentWorkspace';

// Комната чата, которую реально показывает WorkspaceChatPanel: активное пространство, а если
// у него нет своей комнаты (пустой хаб приглашённого) — первая доступная. Единый резолвер,
// чтобы бейдж непрочитанного совпадал с ВИДИМЫМ чатом (иначе «3» на иконке — из другого
// пространства, которое тут не открыто, и её нельзя погасить).
export function resolveActiveChatRoom(
  rooms: ChatRoom[],
  activeWorkspaceId: string | null | undefined,
): ChatRoom | null {
  if (activeWorkspaceId) {
    const match = rooms.find((r) => r.workspaceId === activeWorkspaceId);
    if (match) return match;
  }
  return rooms[0] ?? null;
}

// Непрочитанное ТОЛЬКО в активном (видимом) чате — для бейджа иконки «Чат» и вкладки «Чат».
// Не сумма по всем пространствам: сумма вводила в заблуждение (бейдж висел из-за чужого чата).
export function useActiveChatUnread(): number {
  const { rooms } = useChatRooms();
  const { workspace } = useCurrentWorkspace();
  return resolveActiveChatRoom(rooms, workspace?.id)?.unreadCount ?? 0;
}

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
