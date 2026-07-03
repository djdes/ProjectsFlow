import type { Notification } from '@/domain/notifications/Notification';

export type ActivityKind =
  | 'task_created'
  | 'task_status_changed'
  | 'task_updated'
  | 'task_deleted'
  | 'task_commented'
  | 'project_created'
  | 'project_archived'
  | 'project_deleted'
  | 'member_added'
  | 'member_removed'
  | 'member_role_changed';

// Одно изменённое поле для task_updated (Notion-style дифф). null = было/стало пусто.
export type ActivityFieldChange = {
  readonly field: string;
  readonly old: string | null;
  readonly new: string | null;
};

export type ActivityPayload = {
  readonly projectName?: string;
  readonly taskId?: string;
  readonly commentId?: string;
  readonly taskExcerpt?: string;
  readonly oldStatus?: string;
  readonly newStatus?: string;
  readonly commentExcerpt?: string;
  readonly targetUserId?: string;
  readonly role?: string;
  readonly changes?: readonly ActivityFieldChange[];
};

// Амбиентное действие (создание/статус/удаление задач, комментарии, проекты, участники).
export type ActivityEventItem = {
  readonly type: 'activity';
  readonly createdAt: Date;
  readonly id: string;
  readonly kind: ActivityKind;
  readonly projectId: string;
  readonly actorUserId: string | null;
  readonly actorDisplayName: string | null;
  readonly actorAvatarUrl: string | null;
  readonly targetDisplayName: string | null;
  readonly payload: ActivityPayload | null;
};

// Адресное уведомление (делегирование/инвайт/упоминание) — переиспользует существующий тип.
export type NotificationFeedItem = {
  readonly type: 'notification';
  readonly createdAt: Date;
  readonly notification: Notification;
};

export type FeedItem = ActivityEventItem | NotificationFeedItem;
