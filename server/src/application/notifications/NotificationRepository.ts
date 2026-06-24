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
  // before — курсор пагинации (createdAt < before). Нужен ленте активности, где
  // уведомления мёржатся с amбиентными событиями и страница уходит в прошлое.
  listByUser(
    userId: string,
    opts: { limit: number; unreadOnly: boolean; before?: Date },
  ): Promise<Notification[]>;
  countUnread(userId: string): Promise<number>;
  // Непрочитанные actionable-уведомления (инвайты/join/делегирования) — для бейджа «Действие».
  countActionableUnread(userId: string): Promise<number>;
  markRead(id: string, userId: string, readAt: Date): Promise<boolean>;
  markAllRead(userId: string, readAt: Date): Promise<number>;
}
