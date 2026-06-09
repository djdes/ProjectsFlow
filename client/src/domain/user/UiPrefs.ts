// Персональные UI-настройки клиента, сохраняемые за аккаунтом (users.ui_prefs, db/069).
// Обобщённый «мешок» preferences: сейчас хранит только группировку блока «Поручено мне»,
// но рассчитан на расширение без новых миграций. Зеркало server/src/domain/user/UiPrefs.ts.

// Режим группировки блока «Поручено мне» на «Входящих».
// project — по проекту (дефолт, как было исторически); created — по дате создания;
// deadline — по дедлайну; priority — по приоритету.
export const ASSIGNED_GROUPINGS = ['project', 'created', 'deadline', 'priority'] as const;
export type AssignedGrouping = (typeof ASSIGNED_GROUPINGS)[number];

export const DEFAULT_ASSIGNED_GROUPING: AssignedGrouping = 'project';

// Человекочитаемые подписи режимов — для дропдауна. Кириллица (пользовательские строки).
export const ASSIGNED_GROUPING_LABELS: Record<AssignedGrouping, string> = {
  project: 'Проект',
  created: 'Дата создания',
  deadline: 'Дедлайн',
  priority: 'Приоритет',
};

export type UiPrefs = {
  readonly inboxAssignedGrouping?: AssignedGrouping;
};
