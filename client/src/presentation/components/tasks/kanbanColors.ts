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
    pill: 'bg-[oklch(32.89%_0.011_91.66/0.08)] text-[oklch(44.25%_0.008_88.71)] dark:bg-[oklch(100%_0_none/0.09)] dark:text-[oklch(81.42%_0.007_88.65)]',
    body: 'bg-[oklch(32.89%_0.011_91.66/0.03)] dark:bg-[oklch(100%_0_none/0.045)]',
    dot: 'bg-muted-foreground/40',
    ring: '[--pf-card-ring:oklch(32.89%_0.011_91.66/0.07)] dark:[--pf-card-ring:oklch(100%_0_none/0.09)]',
    action: 'text-[oklch(48.12%_0.008_97.48)] dark:text-[oklch(68.31%_0.008_88.67)]',
  },
  gray: {
    pill: 'bg-[oklch(19.33%_0.037_85.65/0.11)] text-[oklch(40.19%_0.004_84.57)] dark:bg-[oklch(100%_0_none/0.1)] dark:text-[oklch(79.85%_0.007_88.65)]',
    body: 'bg-[oklch(29.16%_0.064_61.26/0.03)] dark:bg-[oklch(100%_0_none/0.045)]',
    dot: 'bg-[oklch(63.78%_0.008_80.71)]',
    ring: '[--pf-card-ring:oklch(23.78%_0.049_82.45/0.07)] dark:[--pf-card-ring:oklch(100%_0_none/0.09)]',
    action: 'text-[oklch(48.12%_0.008_97.48)] dark:text-[oklch(68.31%_0.008_88.67)]',
  },
  brown: {
    pill: 'bg-[oklch(45.72%_0.088_53.37/0.16)] text-[oklch(41.07%_0.044_52.73)] dark:bg-[oklch(65.85%_0.092_54.11/0.22)] dark:text-[oklch(78.62%_0.059_54.69)]',
    body: 'bg-[oklch(45.72%_0.088_53.37/0.04)] dark:bg-[oklch(65.85%_0.092_54.11/0.07)]',
    dot: 'bg-[oklch(57.33%_0.089_59.28)]',
    ring: '[--pf-card-ring:oklch(45.72%_0.088_53.37/0.09)] dark:[--pf-card-ring:oklch(65.85%_0.092_54.11/0.14)]',
    action: 'text-[oklch(57.33%_0.089_59.28)] dark:text-[oklch(78.62%_0.059_54.69)]',
  },
  orange: {
    pill: 'bg-[oklch(67.85%_0.176_51.47/0.18)] text-[oklch(44.93%_0.095_61.45)] dark:bg-[oklch(76.93%_0.161_57.02/0.22)] dark:text-[oklch(83.28%_0.099_62.33)]',
    body: 'bg-[oklch(67.85%_0.176_51.47/0.05)] dark:bg-[oklch(76.93%_0.161_57.02/0.07)]',
    dot: 'bg-[oklch(70.63%_0.161_58.65)]',
    ring: '[--pf-card-ring:oklch(67.85%_0.176_51.47/0.09)] dark:[--pf-card-ring:oklch(76.93%_0.161_57.02/0.14)]',
    action: 'text-[oklch(70.63%_0.161_58.65)] dark:text-[oklch(83.28%_0.099_62.33)]',
  },
  yellow: {
    pill: 'bg-[oklch(73.83%_0.153_80.82/0.2)] text-[oklch(46.77%_0.0885_86.25)] dark:bg-[oklch(87.04%_0.149_86.63/0.22)] dark:text-[oklch(88.47%_0.106_89.23)]',
    body: 'bg-[oklch(73.83%_0.153_80.82/0.055)] dark:bg-[oklch(87.04%_0.149_86.63/0.07)]',
    dot: 'bg-[oklch(76.93%_0.1453_84.3)]',
    ring: '[--pf-card-ring:oklch(73.83%_0.153_80.82/0.1)] dark:[--pf-card-ring:oklch(87.04%_0.149_86.63/0.14)]',
    action: 'text-[oklch(76.93%_0.1453_84.3)] dark:text-[oklch(88.47%_0.106_89.23)]',
  },
  green: {
    pill: 'bg-[oklch(42.7%_0.1205_149.01/0.157)] text-[oklch(40.5%_0.061_157.59)] dark:bg-[oklch(72.19%_0.1345_156.62/0.22)] dark:text-[oklch(82.41%_0.081_158.54)]',
    body: 'bg-[oklch(39.89%_0.1143_147.79/0.035)] dark:bg-[oklch(72.19%_0.1345_156.62/0.07)]',
    dot: 'bg-[oklch(64.06%_0.114_157.72)]',
    ring: '[--pf-card-ring:oklch(44.02%_0.119_150.75/0.09)] dark:[--pf-card-ring:oklch(72.19%_0.1345_156.62/0.14)]',
    action: 'text-[oklch(64.06%_0.114_157.72)] dark:text-[oklch(82.41%_0.081_158.54)]',
  },
  blue: {
    pill: 'bg-[oklch(56.66%_0.175_253.05/0.204)] text-[oklch(40.24%_0.08_252.57)] dark:bg-[oklch(68.76%_0.146_248.49/0.22)] dark:text-[oklch(80.34%_0.079_247.72)]',
    body: 'bg-[oklch(58.66%_0.1592_248.35/0.047)] dark:bg-[oklch(68.76%_0.146_248.49/0.07)]',
    dot: 'bg-[oklch(60.41%_0.1615_252.33)]',
    ring: '[--pf-card-ring:oklch(57.87%_0.166_250.47/0.094)] dark:[--pf-card-ring:oklch(68.76%_0.146_248.49/0.14)]',
    action: 'text-[oklch(60.41%_0.1615_252.33)] dark:text-[oklch(80.34%_0.079_247.72)]',
  },
  purple: {
    pill: 'bg-[oklch(53.32%_0.178_298.33/0.18)] text-[oklch(40.66%_0.103_300.51)] dark:bg-[oklch(69.08%_0.16_298.93/0.22)] dark:text-[oklch(79.62%_0.094_300.51)]',
    body: 'bg-[oklch(53.32%_0.178_298.33/0.045)] dark:bg-[oklch(69.08%_0.16_298.93/0.07)]',
    dot: 'bg-[oklch(61%_0.152_302.95)]',
    ring: '[--pf-card-ring:oklch(53.32%_0.178_298.33/0.09)] dark:[--pf-card-ring:oklch(69.08%_0.16_298.93/0.14)]',
    action: 'text-[oklch(61%_0.152_302.95)] dark:text-[oklch(79.62%_0.094_300.51)]',
  },
  pink: {
    pill: 'bg-[oklch(59.57%_0.201_353.09/0.17)] text-[oklch(43.1%_0.113_346.04)] dark:bg-[oklch(71.4%_0.177_349.02/0.22)] dark:text-[oklch(81.1%_0.096_347.28)]',
    body: 'bg-[oklch(59.57%_0.201_353.09/0.045)] dark:bg-[oklch(71.4%_0.177_349.02/0.07)]',
    dot: 'bg-[oklch(65.49%_0.168_348.85)]',
    ring: '[--pf-card-ring:oklch(59.57%_0.201_353.09/0.09)] dark:[--pf-card-ring:oklch(71.4%_0.177_349.02/0.14)]',
    action: 'text-[oklch(65.49%_0.168_348.85)] dark:text-[oklch(81.1%_0.096_347.28)]',
  },
  red: {
    pill: 'bg-[oklch(58.17%_0.208_27.77/0.17)] text-[oklch(40.82%_0.108_25.3)] dark:bg-[oklch(66.43%_0.186_25.42/0.22)] dark:text-[oklch(77.98%_0.099_21.86)]',
    body: 'bg-[oklch(58.17%_0.208_27.77/0.045)] dark:bg-[oklch(66.43%_0.186_25.42/0.07)]',
    dot: 'bg-[oklch(63.58%_0.177_25.48)]',
    ring: '[--pf-card-ring:oklch(58.17%_0.208_27.77/0.09)] dark:[--pf-card-ring:oklch(66.43%_0.186_25.42/0.14)]',
    action: 'text-[oklch(63.58%_0.177_25.48)] dark:text-[oklch(77.98%_0.099_21.86)]',
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
