import type { TaskType } from './Task';

// Метаданные типа задачи для UI. Баг подсвечен красноватым — это «сломано, надо чинить»;
// фича нейтральна, потому что это обычный режим работы и красить его не во что.
// Структура зеркалит priorityMeta.ts, чтобы бейджи выглядели однородно.

export type TaskTypeMeta = {
  readonly label: string;
  readonly dotColor: string; // bg-* для маленького дота
  readonly textColor: string; // text-* для подсветки в badge/меню
  readonly badge: string; // фон+текст компактного бейджа на карточке
};

export const TASK_TYPE_META: Record<TaskType, TaskTypeMeta> = {
  // Цвета — тона Notion (.pf-tone-* в styles/globals.css), как у приоритета.
  feature: {
    label: 'Фича',
    dotColor: 'pf-tone-gray bg-tone',
    textColor: 'text-muted-foreground',
    badge: 'pf-tone-gray bg-tone-bg text-tone-fg',
  },
  bug: {
    label: 'Баг',
    dotColor: 'pf-tone-red bg-tone',
    textColor: 'pf-tone-red text-tone',
    badge: 'pf-tone-red bg-tone-bg text-tone-fg',
  },
};

// Режим показа колонки канбана по типу задачи. 'all' — колонка как раньше.
export type ColumnTypeFilter = 'all' | 'bug' | 'feature';

/**
 * Проходит ли задача фильтр колонки по типу.
 *
 * Задача без типа считается ФИЧЕЙ — та же логика, что у классификатора в compose-промпте
 * («при сомнениях — feature»). Поле типа появилось недавно, и у большинства задач оно
 * пустое: отсекай мы null, режим «только фичи» показывал бы почти пустую доску.
 */
export function matchesTypeFilter(
  taskType: TaskType | null | undefined,
  mode: ColumnTypeFilter,
): boolean {
  if (mode === 'all') return true;
  if (mode === 'bug') return taskType === 'bug';
  return taskType !== 'bug';
}
