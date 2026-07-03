// Персональные UI-настройки клиента (users.ui_prefs, db/069). Обобщённый bag preferences:
// сейчас хранит только режим группировки блока «Поручено мне», но рассчитан на расширение
// без новых миграций. Зеркало client/src/domain/user/UiPrefs.ts.

// Режим группировки блока «Поручено мне» на «Входящих».
export const ASSIGNED_GROUPINGS = ['project', 'created', 'deadline', 'priority'] as const;
export type AssignedGrouping = (typeof ASSIGNED_GROUPINGS)[number];

export type UiPrefs = {
  readonly inboxAssignedGrouping?: AssignedGrouping;
  // Порядок строк-свойств в окне задачи (ключи assignee/deadline/priority/mode/files/created).
  // Один на пользователя для всех проектов; неизвестные/недостающие ключи дополняются дефолтом.
  readonly taskPropertyOrder?: readonly string[];
  // Ширина левой панели (px). За аккаунтом → одинакова во всех пространствах.
  readonly sidebarWidth?: number;
};
