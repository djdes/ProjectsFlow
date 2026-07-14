// Вид амбиентного действия в ленте «Все». Адресные события (назначения ответственного,
// инвайты) живут в notifications и подмешиваются в ленту отдельно — здесь только активность.
export type ActivityKind =
  | 'task_created'
  | 'task_status_changed'
  | 'task_updated'
  | 'task_deleted'
  | 'task_commented'
  | 'project_created'
  | 'project_updated'
  | 'project_archived'
  | 'project_deleted'
  | 'member_added'
  | 'member_removed'
  | 'member_role_changed';

// Одно изменённое поле (task_updated): что было → что стало. Значения — уже
// человекочитаемые строки; null = было/стало пусто.
export type ActivityFieldChange = {
  readonly field: string;
  readonly old: string | null;
  readonly new: string | null;
};

// Денормализованный payload — чтобы лента читалась без джойнов и переживала удаление
// сущности (показываем «что было»). Все поля опциональны; набор зависит от kind.
export type ActivityPayload = {
  readonly projectName?: string;
  readonly taskId?: string;
  readonly commentId?: string;
  readonly taskExcerpt?: string;
  readonly oldStatus?: string;
  readonly newStatus?: string;
  readonly commentExcerpt?: string;
  readonly targetUserId?: string;
  readonly targetDisplayName?: string;
  readonly role?: string;
  readonly actorDisplayName?: string;
  // Список изменённых полей для task_updated (Notion-style дифф в ленте).
  readonly changes?: readonly ActivityFieldChange[];
};

export type ActivityEvent = {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorUserId: string | null;
  readonly kind: ActivityKind;
  readonly payload: ActivityPayload | null;
  readonly createdAt: Date;
};
