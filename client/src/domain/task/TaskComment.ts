import type { TaskAttachment } from './TaskAttachment';

// Кто оставил коммент. 'user' — реальный человек через web-UI; 'agent' — автомат
// через MCP/agent-токен (Ralph-диспетчер и Co); 'system' — внутреннее (пока не
// используется). См. spec C:/www/ralph/prompts/comment-actor-kind.md.
export type TaskCommentActorKind = 'user' | 'agent' | 'system';

// Известные agent-имена. Список расширяемо строкой — старые UI-сборки не должны
// падать на новых именах, просто покажут generic 'Агент · {name}'.
export type KnownAgentName =
  | 'ralph-dispatcher'
  | 'ralph-worker'
  | 'ralph-grillme'
  | 'ralph-verify';

// Режим адресации уведомления, выбранный автором в композере. См. db/047.
//   'all'      — уведомить всех участников;
//   'selected' — только выбранных;
//   'none'     — никого.
export type CommentNotifyMode = 'all' | 'selected' | 'none';

// Выбор аудитории из композера, уходит в POST /comments.
export type NotifyAudience = {
  readonly mode: CommentNotifyMode;
  // Для mode==='selected' — выбранные user-id.
  readonly userIds?: readonly string[];
};

export type TaskComment = {
  readonly id: string;
  readonly taskId: string;
  readonly ownerUserId: string;
  readonly body: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  // Тип актора. На старых backend'ах поле может отсутствовать — fallback 'user'
  // мы делаем на маппинге в HttpTaskRepository.
  readonly actorKind: TaskCommentActorKind;
  // Конкретный agent (для UI-title). NULL если actorKind != 'agent'.
  readonly agentName: string | null;
  // Режим адресации уведомления (для меню ⋮ «Кто уведомлён»). Fallback 'all'.
  readonly notifyMode: CommentNotifyMode;
  // Ответ/цитата (db/080). replyToCommentId — id коммента, на который отвечают (обычный
  // ответ И цитата); quotedText — выделенный фрагмент (только цитата), иначе null.
  readonly replyToCommentId: string | null;
  readonly quotedText: string | null;
  // Вложения комментария (на list-эндпоинте). На create — пусто (грузятся отдельно).
  readonly attachments: TaskAttachment[];
};

// Строка журнала доставки уведомления (для меню ⋮ «Кто уведомлён»).
export type CommentNotificationChannel = 'email' | 'telegram';
export type CommentNotificationStatus = 'sent' | 'skipped' | 'failed';

export type CommentNotification = {
  readonly userId: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly channel: CommentNotificationChannel;
  readonly status: CommentNotificationStatus;
  readonly reason: string | null;
  readonly createdAt: Date;
};

// Ответ read-эндпоинта «кто уведомлён»: режим + список доставок.
export type CommentNotifications = {
  readonly notifyMode: CommentNotifyMode;
  readonly recipients: CommentNotification[];
};
