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
// Notion-calm: цвет колонки несёт маленькая точка-маркер (`dot`) рядом с подписью, а тело
// колонки — почти-нейтральная едва заметная тонировка низкой насыщенности (/25 в светлой,
// /[0.05] в тёмной), чтобы доска читалась спокойно, без громких заливок. `pill` оставлен
// в типе для обратной совместимости (используется как приглушённый текстовый цвет, если нужно).
// `gray` — тёплый stone (в пару к тёплым нейтралям темы).
export const KANBAN_COLOR_CLASSES: Record<KanbanColor, KanbanColorClasses> = {
  default: {
    pill: 'text-muted-foreground',
    body: 'bg-muted/40 sm:bg-muted/25',
    dot: 'bg-muted-foreground/40',
  },
  gray: {
    pill: 'text-stone-600 dark:text-stone-300',
    body: 'bg-stone-100/40 dark:bg-stone-500/[0.05]',
    dot: 'bg-stone-400',
  },
  brown: {
    pill: 'text-amber-800 dark:text-amber-200',
    body: 'bg-amber-100/25 dark:bg-amber-800/[0.05]',
    dot: 'bg-amber-700',
  },
  orange: {
    pill: 'text-orange-700 dark:text-orange-200',
    body: 'bg-orange-100/25 dark:bg-orange-500/[0.05]',
    dot: 'bg-orange-500',
  },
  yellow: {
    pill: 'text-yellow-700 dark:text-yellow-100',
    body: 'bg-yellow-100/25 dark:bg-yellow-500/[0.05]',
    dot: 'bg-yellow-400',
  },
  green: {
    pill: 'text-green-700 dark:text-green-200',
    body: 'bg-green-100/25 dark:bg-green-500/[0.05]',
    dot: 'bg-green-500',
  },
  blue: {
    pill: 'text-blue-700 dark:text-blue-200',
    body: 'bg-blue-100/25 dark:bg-blue-500/[0.05]',
    dot: 'bg-blue-500',
  },
  purple: {
    pill: 'text-purple-700 dark:text-purple-200',
    body: 'bg-purple-100/25 dark:bg-purple-500/[0.05]',
    dot: 'bg-purple-500',
  },
  pink: {
    pill: 'text-pink-700 dark:text-pink-200',
    body: 'bg-pink-100/25 dark:bg-pink-500/[0.05]',
    dot: 'bg-pink-500',
  },
  red: {
    pill: 'text-red-700 dark:text-red-200',
    body: 'bg-red-100/25 dark:bg-red-500/[0.05]',
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
