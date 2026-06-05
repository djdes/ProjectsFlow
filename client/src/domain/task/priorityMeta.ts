import type { TaskPriority } from './Task';

// Метаданные для UI: label (Срочно/Высокий/…), dotColor (цветной дот важности),
// textColor (подсветка в badge/меню), border (левый акцент строки списка),
// borderColor (полная 1px-рамка цвета приоритета вокруг Kanban-карточки).
// Стиль Todoist: 1=urgent красный, 2=high оранжевый, 3=medium синий, 4=low серый.
// Нотация «P1..P4» убрана из UI — показываем словесный label + цветную точку.

export type PriorityMeta = {
  readonly label: string;
  readonly dotColor: string;     // bg-* класс для маленького 8px дота
  readonly textColor: string;    // text-* для подсветки в badge / меню
  readonly border: string;       // border-l-* для left-accent border-l-4 в List-view
  readonly borderColor: string;  // border-* (все стороны) для рамки Kanban-карточки
};

export const PRIORITY_META: Record<TaskPriority, PriorityMeta> = {
  1: {
    label: 'Срочно',
    dotColor: 'bg-rose-500',
    textColor: 'text-rose-600 dark:text-rose-400',
    border: 'border-l-rose-500',
    borderColor: 'border-rose-500/70',
  },
  2: {
    label: 'Высокий',
    dotColor: 'bg-orange-500',
    textColor: 'text-orange-600 dark:text-orange-400',
    border: 'border-l-orange-500',
    borderColor: 'border-orange-500/70',
  },
  3: {
    label: 'Средний',
    dotColor: 'bg-blue-500',
    textColor: 'text-blue-600 dark:text-blue-400',
    border: 'border-l-blue-500',
    borderColor: 'border-blue-500/70',
  },
  4: {
    label: 'Низкий',
    dotColor: 'bg-slate-400',
    textColor: 'text-slate-500 dark:text-slate-400',
    border: 'border-l-slate-400',
    borderColor: 'border-slate-400/70',
  },
};
