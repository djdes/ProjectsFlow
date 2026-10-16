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
  // workspaceId — активное пространство: его уведомления плюс личные (приглашения и
  // уведомления без пространства, см. isVisibleInWorkspace). То же во всех методах ниже.
  // before — курсор пагинации (createdAt < before). Нужен ленте активности, где
  // уведомления мёржатся с amбиентными событиями и страница уходит в прошлое.
  listByUser(
    userId: string,
    opts: {
      limit: number;
      unreadOnly: boolean;
      before?: Date;
      workspaceId?: string;
      actionableOnly?: boolean;
      mineOnly?: boolean;
    },
  ): Promise<Notification[]>;
  // since — бейдж колокольчика: новые с тех пор, как человек открывал уведомления, плюс
  // все неотвеченные с действием (приглашения не гаснут от одного взгляда).
  // mineOnly — только «для меня» (MINE_NOTIFICATION_TYPES и задачи, где он исполнитель или автор).
  countUnread(userId: string, workspaceId?: string, opts?: { since?: Date; mineOnly?: boolean }): Promise<number>;
  // Непрочитанные actionable-уведомления (инвайты/join) — для бейджа «Действие».
  countActionableUnread(userId: string, workspaceId?: string): Promise<number>;
  markRead(id: string, userId: string, readAt: Date, workspaceId?: string): Promise<boolean>;
  // Уведомления с действием не трогает: они уходят из «Ждут ответа» только ответом.
  markAllRead(userId: string, readAt: Date, workspaceId?: string): Promise<number>;
}
