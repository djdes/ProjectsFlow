// Кастомные свойства задач (db/109, Notion custom properties).
// Mirrors server/src/domain/task/TaskProperty.ts.

export const TASK_PROPERTY_TYPES = [
  'text',
  'number',
  'select',
  'multi_select',
  'date',
  'checkbox',
  'url',
  'phone',
  'email',
  'person',
] as const;
export type TaskPropertyType = (typeof TASK_PROPERTY_TYPES)[number];

export const TASK_PROPERTY_TYPE_LABELS: Record<TaskPropertyType, string> = {
  text: 'Текст',
  number: 'Число',
  select: 'Селект',
  multi_select: 'Мультиселект',
  date: 'Дата',
  checkbox: 'Чекбокс',
  url: 'Ссылка',
  phone: 'Телефон',
  email: 'Email',
  // Значение — userId участника проекта (Notion Person).
  person: 'Участник',
};

// Опция select/multi_select; color — ключ палитры (RULE_COLOR_* в viewShared).
export type TaskPropertyOption = {
  readonly id: string;
  readonly label: string;
  readonly color: string;
};

export type TaskProperty = {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly type: TaskPropertyType;
  readonly options: TaskPropertyOption[];
  readonly position: number;
};

// Значение свойства у задачи: строка, кодировка по типу (см. db/109):
// text/url — строка; number — '3.14'; select — id опции; multi_select — JSON-массив
// id опций; date — 'YYYY-MM-DD'; checkbox — '1'/''.
export type TaskPropertyValue = {
  readonly taskId: string;
  readonly propertyId: string;
  readonly value: string;
};
