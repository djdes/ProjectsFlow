import type { KanbanColor } from '@/domain/kanban/KanbanSettings';

export type KanbanColorClasses = {
  // Залитая «пилюля» заголовка колонки: фон + цвет текста (Notion: h=20px, radius 10px).
  readonly pill: string;
  // Тонировка тела колонки. Намеренно почти прозрачная (3–5% альфы в светлой теме):
  // колонку отделяет от фона не заливка, а белые карточки с кольцом поверх неё.
  readonly body: string;
  // Сплошной свотч цвета: точка 8×8 внутри пилюли и кружок в пикере цветов.
  readonly dot: string;
  // Цветное кольцо карточки — третий слой её тени. Отдаём через CSS-переменную
  // --pf-card-ring, чтобы карточка не знала про колонку: она просто читает var()
  // (с нейтральным фолбэком, если её рендерят вне доски).
  readonly ring: string;
  // Цвет текста «пустой карточки» внизу колонки (кнопка «Создать задачу», MEASURED §5b).
  // У Notion это тот же сплошной тон, что и точка статуса: замеры blue/green дали текст
  // ровно в цвет точки. Нейтрали — единственное исключение: серая точка rgb(142,139,134)
  // как ТЕКСТ уже нечитаема, поэтому у Notion там тон потемнее — rgb(95,94,89).
  // Тёмная тема зеркально: светлый тинт того же цвета (он же текст пилюли), у нейтралей —
  // приглушённый серый, чтобы кнопка оставалась тише названия колонки.
  readonly action: string;
};

// ВАЖНО: только статические литеральные классы — Tailwind JIT не видит интерполированные имена.
// Значения светлой темы для gray/blue/green сняты с живой страницы Notion (см.
// reference/notion-project-page/MEASURED.md), остальные цвета выведены по той же логике:
// тело колонки 3–5% альфы, пилюля 11–20%, кольцо карточки ~9%, текст «пустой карточки» —
// сплошной тон точки. Тёмная тема строится зеркально: подложки светлеют
// (белый/осветлённый оттенок поверх графита), текст пилюли — светлый тон того же цвета.
// `gray` — тёплый (в пару к тёплым нейтралям темы).
export const KANBAN_COLOR_CLASSES: Record<KanbanColor, KanbanColorClasses> = {
  default: {
    pill: 'bg-[rgba(55,53,47,0.08)] text-[rgb(85,83,78)] dark:bg-[rgba(255,255,255,0.09)] dark:text-[rgb(196,194,189)]',
    body: 'bg-[rgba(55,53,47,0.03)] dark:bg-[rgba(255,255,255,0.045)]',
    dot: 'bg-muted-foreground/40',
    ring: '[--pf-card-ring:rgba(55,53,47,0.07)] dark:[--pf-card-ring:rgba(255,255,255,0.09)]',
    action: 'text-[rgb(95,94,89)] dark:text-[rgb(155,153,148)]',
  },
  gray: {
    pill: 'bg-[rgba(28,19,1,0.11)] text-[rgb(73,72,70)] dark:bg-[rgba(255,255,255,0.1)] dark:text-[rgb(191,189,184)]',
    body: 'bg-[rgba(66,35,3,0.03)] dark:bg-[rgba(255,255,255,0.045)]',
    dot: 'bg-[rgb(142,139,134)]',
    ring: '[--pf-card-ring:rgba(42,28,0,0.07)] dark:[--pf-card-ring:rgba(255,255,255,0.09)]',
    action: 'text-[rgb(95,94,89)] dark:text-[rgb(155,153,148)]',
  },
  brown: {
    pill: 'bg-[rgba(125,72,35,0.16)] text-[rgb(94,68,52)] dark:bg-[rgba(190,130,90,0.22)] dark:text-[rgb(216,176,150)]',
    body: 'bg-[rgba(125,72,35,0.04)] dark:bg-[rgba(190,130,90,0.07)]',
    dot: 'bg-[rgb(159,107,64)]',
    ring: '[--pf-card-ring:rgba(125,72,35,0.09)] dark:[--pf-card-ring:rgba(190,130,90,0.14)]',
    action: 'text-[rgb(159,107,64)] dark:text-[rgb(216,176,150)]',
  },
  orange: {
    pill: 'bg-[rgba(233,113,0,0.18)] text-[rgb(122,71,17)] dark:bg-[rgba(255,150,60,0.22)] dark:text-[rgb(247,186,132)]',
    body: 'bg-[rgba(233,113,0,0.05)] dark:bg-[rgba(255,150,60,0.07)]',
    dot: 'bg-[rgb(232,131,26)]',
    ring: '[--pf-card-ring:rgba(233,113,0,0.09)] dark:[--pf-card-ring:rgba(255,150,60,0.14)]',
    action: 'text-[rgb(232,131,26)] dark:text-[rgb(247,186,132)]',
  },
  yellow: {
    pill: 'bg-[rgba(219,158,0,0.2)] text-[rgb(112,86,17)] dark:bg-[rgba(255,205,80,0.22)] dark:text-[rgb(245,214,133)]',
    body: 'bg-[rgba(219,158,0,0.055)] dark:bg-[rgba(255,205,80,0.07)]',
    dot: 'bg-[rgb(223,171,45)]',
    ring: '[--pf-card-ring:rgba(219,158,0,0.1)] dark:[--pf-card-ring:rgba(255,205,80,0.14)]',
    action: 'text-[rgb(223,171,45)] dark:text-[rgb(245,214,133)]',
  },
  green: {
    pill: 'bg-[rgba(0,96,38,0.157)] text-[rgb(42,83,60)] dark:bg-[rgba(80,190,130,0.22)] dark:text-[rgb(152,214,178)]',
    body: 'bg-[rgba(3,87,31,0.035)] dark:bg-[rgba(80,190,130,0.07)]',
    dot: 'bg-[rgb(70,161,113)]',
    ring: '[--pf-card-ring:rgba(0,100,45,0.09)] dark:[--pf-card-ring:rgba(80,190,130,0.14)]',
    action: 'text-[rgb(70,161,113)] dark:text-[rgb(152,214,178)]',
  },
  blue: {
    pill: 'bg-[rgba(0,118,217,0.204)] text-[rgb(38,74,114)] dark:bg-[rgba(70,160,240,0.22)] dark:text-[rgb(150,196,240)]',
    body: 'bg-[rgba(0,128,213,0.047)] dark:bg-[rgba(70,160,240,0.07)]',
    dot: 'bg-[rgb(39,131,222)]',
    ring: '[--pf-card-ring:rgba(0,124,215,0.094)] dark:[--pf-card-ring:rgba(70,160,240,0.14)]',
    action: 'text-[rgb(39,131,222)] dark:text-[rgb(150,196,240)]',
  },
  purple: {
    pill: 'bg-[rgba(124,77,196,0.18)] text-[rgb(83,58,120)] dark:bg-[rgba(170,130,240,0.22)] dark:text-[rgb(198,175,240)]',
    body: 'bg-[rgba(124,77,196,0.045)] dark:bg-[rgba(170,130,240,0.07)]',
    dot: 'bg-[rgb(150,105,205)]',
    ring: '[--pf-card-ring:rgba(124,77,196,0.09)] dark:[--pf-card-ring:rgba(170,130,240,0.14)]',
    action: 'text-[rgb(150,105,205)] dark:text-[rgb(198,175,240)]',
  },
  pink: {
    pill: 'bg-[rgba(210,57,137,0.17)] text-[rgb(122,50,93)] dark:bg-[rgba(240,110,180,0.22)] dark:text-[rgb(240,168,205)]',
    body: 'bg-[rgba(210,57,137,0.045)] dark:bg-[rgba(240,110,180,0.07)]',
    dot: 'bg-[rgb(216,95,161)]',
    ring: '[--pf-card-ring:rgba(210,57,137,0.09)] dark:[--pf-card-ring:rgba(240,110,180,0.14)]',
    action: 'text-[rgb(216,95,161)] dark:text-[rgb(240,168,205)]',
  },
  red: {
    pill: 'bg-[rgba(219,47,42,0.17)] text-[rgb(122,45,42)] dark:bg-[rgba(240,90,85,0.22)] dark:text-[rgb(240,158,155)]',
    body: 'bg-[rgba(219,47,42,0.045)] dark:bg-[rgba(240,90,85,0.07)]',
    dot: 'bg-[rgb(226,85,80)]',
    ring: '[--pf-card-ring:rgba(219,47,42,0.09)] dark:[--pf-card-ring:rgba(240,90,85,0.14)]',
    action: 'text-[rgb(226,85,80)] dark:text-[rgb(240,158,155)]',
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
