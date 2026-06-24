import type { Notification } from '@/domain/notifications/Notification';

export interface NotificationRepository {
  list(opts: { unreadOnly: boolean; limit: number }): Promise<Notification[]>;
  countUnread(): Promise<number>;
  // Непрочитанные actionable-уведомления (инвайты/join/делегирования) — бейдж «Действие».
  countActionableUnread(): Promise<number>;
  markRead(id: string): Promise<void>;
  markAllRead(): Promise<number>;
}
