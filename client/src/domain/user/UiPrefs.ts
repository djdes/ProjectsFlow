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

// Ключи строк-свойств в окне задачи. Порядок ниже — дефолтный (как было исторически).
export const TASK_PROPERTY_KEYS = [
  'assignee',
  'deadline',
  'priority',
  'mode',
  'files',
  'created',
] as const;
export type TaskPropertyKey = (typeof TASK_PROPERTY_KEYS)[number];

// Нормализуем сохранённый порядок: оставляем только известные ключи, дополняем
// недостающими в дефолтном порядке (устойчиво к добавлению новых свойств в будущем).
export function normalizeTaskPropertyOrder(saved: readonly string[] | undefined): TaskPropertyKey[] {
  const known = new Set<string>(TASK_PROPERTY_KEYS);
  const seen = new Set<string>();
  const out: TaskPropertyKey[] = [];
  for (const k of saved ?? []) {
    if (known.has(k) && !seen.has(k)) {
      seen.add(k);
      out.push(k as TaskPropertyKey);
    }
  }
  for (const k of TASK_PROPERTY_KEYS) {
    if (!seen.has(k)) out.push(k);
  }
  return out;
}

export type UiPrefs = {
  readonly inboxAssignedGrouping?: AssignedGrouping;
  // Порядок строк-свойств окна задачи (TaskPropertyKey[]). Один на пользователя, все проекты.
  readonly taskPropertyOrder?: readonly string[];
  // Ширина левой панели (px), тянется ручкой у правого края. За аккаунтом → одинакова
  // во всех пространствах и переживает перезагрузку. Клиент дополнительно кэширует в localStorage.
  readonly sidebarWidth?: number;
};
