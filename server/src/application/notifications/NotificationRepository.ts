import type {
  Notification,
  NotificationPayload,
} from '../../domain/notifications/Notification.js';

export type CreateNotificationInput = {
  readonly id: string;
  readonly userId: string;
  readonly payload: NotificationPayload;
};

export interface NotificationRepository {
  create(input: CreateNotificationInput): Promise<Notification>;
  // Параметры для будущей вкладки «Уведомления». Сейчас никто не вызывает —
  // только create, но контракт лучше зафиксировать сразу.
  listByUser(userId: string, opts: { limit: number; unreadOnly: boolean }): Promise<Notification[]>;
  countUnread(userId: string): Promise<number>;
  markRead(id: string, userId: string, readAt: Date): Promise<boolean>;
  markAllRead(userId: string, readAt: Date): Promise<number>;
}
