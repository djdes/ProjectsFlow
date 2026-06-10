import type { KanbanColor } from '@/domain/kanban/KanbanSettings';

export type KanbanColorClasses = {
  // Цветная «пилюля» вокруг заголовка колонки.
  readonly pill: string;
  // Очень мягкая тонировка тела колонки (header pill + soft body — стиль Notion).
  readonly body: string;
  // Сплошной свотч для пикера цвета.
  readonly dot: string;
};

// ВАЖНО: только статические литеральные классы — Tailwind JIT не видит интерполированные имена.
// Пастель Notion: пилюля — спокойный *-100 фон, тело колонки — едва заметная тонировка
// (/40 в светлой, /[0.07] в тёмной). `gray` — тёплый stone (в пару к тёплым нейтралям темы).
export const KANBAN_COLOR_CLASSES: Record<KanbanColor, KanbanColorClasses> = {
  default: {
    pill: 'bg-muted text-muted-foreground',
    body: 'bg-muted/60 sm:bg-muted/30',
    dot: 'bg-muted-foreground/40',
  },
  gray: {
    pill: 'bg-stone-200/70 text-stone-700 dark:bg-stone-500/20 dark:text-stone-300',
    body: 'bg-stone-100/50 dark:bg-stone-500/[0.07]',
    dot: 'bg-stone-400',
  },
  brown: {
    pill: 'bg-amber-100 text-amber-900 dark:bg-amber-700/20 dark:text-amber-200',
    body: 'bg-amber-100/40 dark:bg-amber-800/[0.07]',
    dot: 'bg-amber-700',
  },
  orange: {
    pill: 'bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-200',
    body: 'bg-orange-100/40 dark:bg-orange-500/[0.07]',
    dot: 'bg-orange-500',
  },
  yellow: {
    pill: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-100',
    body: 'bg-yellow-100/40 dark:bg-yellow-500/[0.07]',
    dot: 'bg-yellow-400',
  },
  green: {
    pill: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-200',
    body: 'bg-green-100/40 dark:bg-green-500/[0.07]',
    dot: 'bg-green-500',
  },
  blue: {
    pill: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-200',
    body: 'bg-blue-100/40 dark:bg-blue-500/[0.07]',
    dot: 'bg-blue-500',
  },
  purple: {
    pill: 'bg-purple-100 text-purple-800 dark:bg-purple-500/20 dark:text-purple-200',
    body: 'bg-purple-100/40 dark:bg-purple-500/[0.07]',
    dot: 'bg-purple-500',
  },
  pink: {
    pill: 'bg-pink-100 text-pink-800 dark:bg-pink-500/20 dark:text-pink-200',
    body: 'bg-pink-100/40 dark:bg-pink-500/[0.07]',
    dot: 'bg-pink-500',
  },
  red: {
    pill: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-200',
    body: 'bg-red-100/40 dark:bg-red-500/[0.07]',
    dot: 'bg-red-500',
  },
};

// Русские подписи цветов для пикера (как в примере Notion).
export const KANBAN_COLOR_LABELS: Record<KanbanColor, string> = {
  default: 'По умолчанию',
  gray: 'Серый',
  brown: 'Коричневый',
  orange: 'Оранжевый',
  yellow: 'Жёлтый',
  green: 'Зелёный',
  blue: 'Синий',
  purple: 'Фиолетовый',
  pink: 'Розовый',
  red: 'Красный',
};
