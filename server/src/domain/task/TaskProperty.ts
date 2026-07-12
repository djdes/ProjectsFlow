// Кастомные свойства задач (db/109, Notion custom properties).
// Mirrors client/src/domain/task/TaskProperty.ts.

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
  // Значение — userId участника проекта (Notion Person).
  'person',
] as const;
export type TaskPropertyType = (typeof TASK_PROPERTY_TYPES)[number];

// Опция select/multi_select; color — ключ палитры (slate|blue|green|…), рендерит клиент.
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

// Значение свойства у задачи: строка, кодировка зависит от типа (см. db/109).
export type TaskPropertyValue = {
  readonly taskId: string;
  readonly propertyId: string;
  readonly value: string;
};
