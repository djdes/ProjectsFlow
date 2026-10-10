import type { TaskPriority } from './Task';

// Метаданные для UI: label (Срочно/Высокий/…), dotColor (цветной дот важности),
// textColor (подсветка в badge/меню), border (цветной кант в начале строки: border-s-4 в
// List-view, border-s-2 на Kanban-карточке).
// Стиль Todoist: 1=urgent красный, 2=high оранжевый, 3=medium синий, 4=low серый.
// Нотация «P1..P4» убрана из UI — показываем словесный label + цветную точку.
// Цвета — тона Notion (класс .pf-tone-* + утилиты tone, см. styles/globals.css): одинаково
// читаются в светлой и тёмной теме. Класс тона идёт в той же строке, что и утилита, —
// значение подхватывается на том же элементе.

export type PriorityMeta = {
  readonly label: string;
  readonly dotColor: string;     // bg-* класс для маленького 8px дота
  readonly textColor: string;    // text-* для подсветки в badge / меню
  readonly border: string;       // border-s-* цвет канта в начале строки (List-view и Kanban)
};

export const PRIORITY_META: Record<TaskPriority, PriorityMeta> = {
  1: {
    label: 'Срочно',
    dotColor: 'pf-tone-red bg-tone',
    textColor: 'pf-tone-red text-tone',
    border: 'pf-tone-red border-s-tone',
  },
  2: {
    label: 'Высокий',
    dotColor: 'pf-tone-orange bg-tone',
    textColor: 'pf-tone-orange text-tone',
    border: 'pf-tone-orange border-s-tone',
  },
  3: {
    label: 'Средний',
    dotColor: 'pf-tone-blue bg-tone',
    textColor: 'pf-tone-blue text-tone',
    border: 'pf-tone-blue border-s-tone',
  },
  4: {
    label: 'Низкий',
    dotColor: 'pf-tone-gray bg-tone',
    textColor: 'text-muted-foreground',
    border: 'pf-tone-gray border-s-tone',
  },
};
