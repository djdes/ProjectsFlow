import type { Notification } from '@/domain/notifications/Notification';

export interface NotificationRepository {
  list(opts: { unreadOnly: boolean; limit: number }): Promise<Notification[]>;
  countUnread(): Promise<number>;
  markRead(id: string): Promise<void>;
  markAllRead(): Promise<number>;
}
