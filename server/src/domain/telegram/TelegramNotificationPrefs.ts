// Multi-user TG-уведомления: per-user prefs какие события приходят в @projectsflow_bot.
// Хранится JSON в users.tg_notification_prefs (NULL = дефолты).

export type TelegramNotifKind =
  | 'commentOnMyTask'   // комментарий на задаче, где я owner/participant
  | 'mention'           // @mention меня в комменте
  | 'statusChange'      // изменение статуса моей задачи
  | 'ralphQuestion'     // вопрос от Ralph-агента (ralph-question marker)
  | 'ralphAnswer'       // ответ на мой вопрос (обычно уже знаю — дефолт off)
  | 'taskDone'          // моя задача успешно завершена агентом
  | 'serverAlert';      // алерт мониторинга сервера (диск/процесс/рестарты)

export type TelegramNotificationPrefs = Partial<Record<TelegramNotifKind, boolean>>;

// Дефолты: всё включено КРОМЕ ralphAnswer (обычно юзер уже в курсе своего вопроса).
// Используется при отсутствии записи в БД или отсутствии конкретного ключа.
const DEFAULTS: Required<TelegramNotificationPrefs> = {
  commentOnMyTask: true,
  mention: true,
  statusChange: true,
  ralphQuestion: true,
  ralphAnswer: false,
  taskDone: true,
  serverAlert: true,
};

export function resolveTgPref(
  prefs: TelegramNotificationPrefs | null | undefined,
  kind: TelegramNotifKind,
): boolean {
  const v = prefs?.[kind];
  return typeof v === 'boolean' ? v : DEFAULTS[kind];
}

export function getAllTgPrefsResolved(
  prefs: TelegramNotificationPrefs | null | undefined,
): Required<TelegramNotificationPrefs> {
  return {
    commentOnMyTask: resolveTgPref(prefs, 'commentOnMyTask'),
    mention: resolveTgPref(prefs, 'mention'),
    statusChange: resolveTgPref(prefs, 'statusChange'),
    ralphQuestion: resolveTgPref(prefs, 'ralphQuestion'),
    ralphAnswer: resolveTgPref(prefs, 'ralphAnswer'),
    taskDone: resolveTgPref(prefs, 'taskDone'),
    serverAlert: resolveTgPref(prefs, 'serverAlert'),
  };
}
