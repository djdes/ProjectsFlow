// Зеркало серверного домена: пер-участниковые настройки email-оповещений по проекту.
export type NotifEventType =
  | 'task_created'
  | 'task_done'
  | 'comment_created'
  | 'member_changed'
  | 'commit_linked'
  | 'kb_updated';

export type NotifSource = 'team' | 'mcp';

export type NotificationPrefs = Partial<Record<NotifEventType, { team: boolean; mcp: boolean }>>;

// Дефолт: действия команды оповещают (on), действия MCP — нет (off).
export function resolvePref(
  prefs: NotificationPrefs | null | undefined,
  type: NotifEventType,
  source: NotifSource,
): boolean {
  const entry = prefs?.[type];
  if (entry && typeof entry[source] === 'boolean') return entry[source];
  return source === 'team';
}

// Подписи для UI «Мои уведомления». Порядок = порядок отображения.
export const NOTIF_EVENT_LABELS: ReadonlyArray<{ type: NotifEventType; label: string }> = [
  { type: 'task_created', label: 'Создание задачи' },
  { type: 'task_done', label: 'Задача выполнена' },
  { type: 'comment_created', label: 'Новый комментарий' },
  { type: 'member_changed', label: 'Изменения в команде' },
  { type: 'commit_linked', label: 'Привязка коммита' },
  { type: 'kb_updated', label: 'Обновление базы знаний' },
];
