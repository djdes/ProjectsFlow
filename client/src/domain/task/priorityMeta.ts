import type { TaskPriority } from './Task';

// Метаданные для UI: label (для dropdown'ов/badge'ей), short (P1..P4 на карточке),
// dotColor (фон цветного дота на trigger'е/badge'е), border (левый акцент карточки).
// Стиль Todoist: 1=urgent красный, 2=high оранжевый, 3=medium синий, 4=low серый.

export type PriorityMeta = {
  readonly label: string;
  readonly short: string;
  readonly dotColor: string;   // bg-* класс для маленького 8px дота
  readonly textColor: string;  // text-* для подсветки в badge / меню
  readonly border: string;     // border-* для left-accent border-l-4 на карточке
};

export const PRIORITY_META: Record<TaskPriority, PriorityMeta> = {
  1: {
    label: 'Срочно',
    short: 'P1',
    dotColor: 'bg-rose-500',
    textColor: 'text-rose-600 dark:text-rose-400',
    border: 'border-l-rose-500',
  },
  2: {
    label: 'Высокий',
    short: 'P2',
    dotColor: 'bg-orange-500',
    textColor: 'text-orange-600 dark:text-orange-400',
    border: 'border-l-orange-500',
  },
  3: {
    label: 'Средний',
    short: 'P3',
    dotColor: 'bg-blue-500',
    textColor: 'text-blue-600 dark:text-blue-400',
    border: 'border-l-blue-500',
  },
  4: {
    label: 'Низкий',
    short: 'P4',
    dotColor: 'bg-slate-400',
    textColor: 'text-slate-500 dark:text-slate-400',
    border: 'border-l-slate-400',
  },
};
