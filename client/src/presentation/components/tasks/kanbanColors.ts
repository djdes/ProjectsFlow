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
// `default`/`gray` держим близко к нейтральному текущему виду доски; остальные — пастель Notion.
// Тёмная тема: низкая прозрачность тела + читаемый текст пилюли.
export const KANBAN_COLOR_CLASSES: Record<KanbanColor, KanbanColorClasses> = {
  default: {
    pill: 'bg-muted text-muted-foreground',
    body: 'bg-muted/60 sm:bg-muted/30',
    dot: 'bg-muted-foreground/40',
  },
  gray: {
    pill: 'bg-slate-200 text-slate-700 dark:bg-slate-500/25 dark:text-slate-200',
    body: 'bg-slate-100/70 dark:bg-slate-500/10',
    dot: 'bg-slate-400',
  },
  brown: {
    pill: 'bg-amber-200/70 text-amber-900 dark:bg-amber-700/30 dark:text-amber-200',
    body: 'bg-amber-100/50 dark:bg-amber-800/10',
    dot: 'bg-amber-700',
  },
  orange: {
    pill: 'bg-orange-200/80 text-orange-800 dark:bg-orange-500/25 dark:text-orange-200',
    body: 'bg-orange-100/50 dark:bg-orange-500/10',
    dot: 'bg-orange-500',
  },
  yellow: {
    pill: 'bg-yellow-200/80 text-yellow-800 dark:bg-yellow-500/25 dark:text-yellow-100',
    body: 'bg-yellow-100/50 dark:bg-yellow-500/10',
    dot: 'bg-yellow-400',
  },
  green: {
    pill: 'bg-green-200/80 text-green-800 dark:bg-green-500/25 dark:text-green-200',
    body: 'bg-green-100/50 dark:bg-green-500/10',
    dot: 'bg-green-500',
  },
  blue: {
    pill: 'bg-blue-200/80 text-blue-800 dark:bg-blue-500/25 dark:text-blue-200',
    body: 'bg-blue-100/50 dark:bg-blue-500/10',
    dot: 'bg-blue-500',
  },
  purple: {
    pill: 'bg-purple-200/80 text-purple-800 dark:bg-purple-500/25 dark:text-purple-200',
    body: 'bg-purple-100/50 dark:bg-purple-500/10',
    dot: 'bg-purple-500',
  },
  pink: {
    pill: 'bg-pink-200/80 text-pink-800 dark:bg-pink-500/25 dark:text-pink-200',
    body: 'bg-pink-100/50 dark:bg-pink-500/10',
    dot: 'bg-pink-500',
  },
  red: {
    pill: 'bg-red-200/80 text-red-800 dark:bg-red-500/25 dark:text-red-200',
    body: 'bg-red-100/50 dark:bg-red-500/10',
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
