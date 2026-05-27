import type {
  Notification,
  NotificationPayload,
} from '@/domain/notifications/Notification';
import type { NotificationRepository } from '@/application/notifications/NotificationRepository';
import { httpClient } from './httpClient';

type NotificationDto = {
  id: string;
  userId: string;
  payload: NotificationPayload;
  readAt: string | null;
  createdAt: string;
};

function fromDto(dto: NotificationDto): Notification {
  // Защита от double-serialized JSON: MariaDB хранит JSON как LONGTEXT, mysql2
  // возвращает строку. Если сервер не распарсил — payload прилетит как string.
  const payload: NotificationPayload =
    typeof dto.payload === 'string'
      ? (JSON.parse(dto.payload) as NotificationPayload)
      : dto.payload;
  return {
    id: dto.id,
    userId: dto.userId,
    payload,
    readAt: dto.readAt ? new Date(dto.readAt) : null,
    createdAt: new Date(dto.createdAt),
  };
}

export class HttpNotificationRepository implements NotificationRepository {
  async list(opts: { unreadOnly: boolean; limit: number }): Promise<Notification[]> {
    const params = new URLSearchParams();
    if (opts.unreadOnly) params.set('unread', '1');
    if (opts.limit) params.set('limit', String(opts.limit));
    const query = params.toString();
    const { notifications } = await httpClient.get<{ notifications: NotificationDto[] }>(
      `/notifications${query ? `?${query}` : ''}`,
    );
    return notifications.map(fromDto);
  }

  async countUnread(): Promise<number> {
    const { count } = await httpClient.get<{ count: number }>('/notifications/unread-count');
    return count;
  }

  async markRead(id: string): Promise<void> {
    await httpClient.post<void>(`/notifications/${id}/read`);
  }

  async markAllRead(): Promise<number> {
    const { updated } = await httpClient.post<{ updated: number }>('/notifications/read-all');
    return updated;
  }
}
