import type { TaskSnapshot, TaskVersionField } from '@/domain/task/TaskVersion';

export const VERSION_FIELD_OPTIONS: ReadonlyArray<{
  readonly field: TaskVersionField;
  readonly label: string;
}> = [
  { field: 'created', label: 'Создание задачи' },
  { field: 'status', label: 'Статус' },
  { field: 'deadline', label: 'Дедлайн и даты' },
  { field: 'assignee', label: 'Ответственный' },
  { field: 'description', label: 'Описание' },
  { field: 'priority', label: 'Приоритет' },
  { field: 'ralphMode', label: 'Режим работы' },
  { field: 'appearance', label: 'Оформление' },
  { field: 'parent', label: 'Родительская задача' },
  { field: 'project', label: 'Проект' },
  { field: 'cancellation', label: 'Отмена работы' },
  { field: 'files', label: 'Файлы' },
  { field: 'customProperties', label: 'Свойства' },
  { field: 'commits', label: 'Коммиты' },
];

export const ALL_VERSION_FIELDS = VERSION_FIELD_OPTIONS.map((option) => option.field);

const VERSION_FIELD_LABELS = new Map(
  VERSION_FIELD_OPTIONS.map((option) => [option.field, option.label] as const),
);

export function changedFieldsLabel(fields: readonly TaskVersionField[]): string {
  if (fields.length === 0) return 'Изменение задачи';
  return fields.map((field) => VERSION_FIELD_LABELS.get(field) ?? field).join(', ');
}

export function snapshotTaskTitle(snapshot: TaskSnapshot): string {
  const description = snapshot.description?.trim() ?? '';
  const firstLine = description.split('\n', 1)[0]?.trim() ?? '';
  return firstLine || 'Без названия';
}
