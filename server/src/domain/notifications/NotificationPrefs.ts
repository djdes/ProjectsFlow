// Пер-участниковые настройки email-оповещений по проекту.
// Матрица «тип события × источник»: для каждого типа отдельно — приходит ли письмо при
// действии человека (team) и при действии через MCP/agent-токен (mcp).

export type NotifEventType =
  | 'task_created'
  | 'task_done'
  | 'status_changed'
  | 'comment_created'
  | 'member_changed'
  | 'commit_linked'
  | 'kb_updated'
  | 'server_alert';

export const NOTIF_EVENT_TYPES: readonly NotifEventType[] = [
  'task_created',
  'task_done',
  'status_changed',
  'comment_created',
  'member_changed',
  'commit_linked',
  'kb_updated',
  'server_alert',
];

export type NotifSource = 'team' | 'mcp';

// Частичная карта: отсутствующие ключи берут дефолт. Хранится в project_members.notification_prefs.
export type NotificationPrefs = Partial<Record<NotifEventType, { team: boolean; mcp: boolean }>>;

// Дефолт: действия команды (людей) оповещают (on), действия MCP — нет (off).
export function resolvePref(
  prefs: NotificationPrefs | null | undefined,
  type: NotifEventType,
  source: NotifSource,
): boolean {
  const entry = prefs?.[type];
  if (entry && typeof entry[source] === 'boolean') return entry[source];
  return source === 'team';
}
