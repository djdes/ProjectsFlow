import type { CSSProperties } from 'react';

// Обложка проекта (Notion-style). Значение project.coverUrl:
//  - `gradient:<id>` — пресет из палитр ниже (чистый CSS: одноцветные градиенты COVER_GRADIENTS
//    или многослойные «арт»-обложки COVER_SCENES). Всегда рендерится, без внешних зависимостей.
//  - любой URL — картинка пользователя (загруженный файл `/api/projects/:id/cover/...` или
//    вставленная ссылка). Позиция по вертикали — project.coverPosition (0–100 %).
//
// Готовые «фото» намеренно НЕ тянем со стоков (picsum/unsplash): внешние CDN нестабильны
// (таймауты/блокировки), а обложка — заметная часть шапки. Свои фотографии пользователь
// добавляет через «Загрузить» или «Ссылка».

export type CoverPreset = { readonly id: string; readonly css: string };

const GRADIENT_PREFIX = 'gradient:';

// «Цвета и градиенты» — простые двухцветные градиенты (как палитра Notion).
export const COVER_GRADIENTS: readonly CoverPreset[] = [
  { id: 'rose', css: 'linear-gradient(135deg,oklch(79.46% 0.172 323.15) 0%,oklch(67.29% 0.193 16.23) 100%)' },
  { id: 'sunset', css: 'linear-gradient(135deg,oklch(87.56% 0.134 91.78) 0%,oklch(79.34% 0.118 36.95) 100%)' },
  { id: 'peach', css: 'linear-gradient(135deg,oklch(95.16% 0.04 75.8) 0%,oklch(83.6% 0.088 38.95) 100%)' },
  { id: 'lime', css: 'linear-gradient(135deg,oklch(93.61% 0.164 123.63) 0%,oklch(85.56% 0.124 147.8) 100%)' },
  { id: 'mint', css: 'linear-gradient(135deg,oklch(89.69% 0.149 154.48) 0%,oklch(83.32% 0.083 229.95) 100%)' },
  { id: 'sky', css: 'linear-gradient(135deg,oklch(81.54% 0.089 260.01) 0%,oklch(91.2% 0.047 227.54) 100%)' },
  { id: 'ocean', css: 'linear-gradient(135deg,oklch(72.45% 0.149 248.09) 0%,oklch(87.44% 0.149 201.21) 100%)' },
  { id: 'indigo', css: 'linear-gradient(135deg,oklch(62.71% 0.164 271.53) 0%,oklch(50.12% 0.138 304.73) 100%)' },
  { id: 'grape', css: 'linear-gradient(135deg,oklch(69.36% 0.199 311.3) 0%,oklch(74.04% 0.195 341.99) 100%)' },
  { id: 'night', css: 'linear-gradient(135deg,oklch(77.83% 0.124 195.57) 0%,oklch(28.35% 0.144 295.36) 100%)' },
  { id: 'slate', css: 'linear-gradient(135deg,oklch(56.93% 0.04 246.02) 0%,oklch(32.26% 0.024 258.36) 100%)' },
  { id: 'blush', css: 'linear-gradient(135deg,oklch(79.12% 0.121 17.63) 0%,oklch(90.43% 0.067 338.05) 100%)' },
];

// «Обложки» — многослойные mesh-градиенты: читаются как абстрактные арт-сцены (небо, аврора,
// закат, океан, туманность). Тоже чистый CSS — грузятся мгновенно и не ломаются.
export const COVER_SCENES: readonly CoverPreset[] = [
  {
    id: 'aurora',
    css: 'radial-gradient(120% 80% at 18% 12%,oklch(72.45% 0.149 248.09 / 0.55) 0%,transparent 55%),radial-gradient(110% 90% at 82% 22%,oklch(65.81% 0.186 301.47 / 0.5) 0%,transparent 55%),radial-gradient(120% 120% at 60% 120%,oklch(87.44% 0.149 201.21 / 0.35) 0%,transparent 60%),linear-gradient(160deg,oklch(24.05% 0.068 260.6) 0%,oklch(31.34% 0.082 259.56) 55%,oklch(24.62% 0.04 249.73) 100%)',
  },
  {
    id: 'dusk',
    css: 'radial-gradient(100% 80% at 20% 100%,oklch(83.04% 0.134 69.84 / 0.6) 0%,transparent 55%),radial-gradient(120% 100% at 85% 15%,oklch(60.57% 0.224 285.06 / 0.55) 0%,transparent 60%),linear-gradient(180deg,oklch(28.5% 0.114 287.64) 0%,oklch(40.03% 0.148 305.02) 45%,oklch(60.64% 0.128 5.51) 100%)',
  },
  {
    id: 'ember',
    css: 'radial-gradient(90% 90% at 30% 110%,oklch(68.89% 0.203 34.09 / 0.7) 0%,transparent 55%),radial-gradient(80% 80% at 80% 0%,oklch(84.89% 0.135 76.8 / 0.5) 0%,transparent 55%),linear-gradient(160deg,oklch(18.78% 0.023 4.39) 0%,oklch(25.65% 0.06 3.59) 55%,oklch(39.61% 0.121 13.46) 100%)',
  },
  {
    id: 'ocean',
    css: 'radial-gradient(120% 90% at 15% 20%,oklch(91.3% 0.133 170.74 / 0.45) 0%,transparent 55%),radial-gradient(120% 120% at 85% 100%,oklch(46.25% 0.134 250.9 / 0.6) 0%,transparent 60%),linear-gradient(165deg,oklch(25.69% 0.055 240.87) 0%,oklch(40.42% 0.081 234.84) 55%,oklch(53.79% 0.09 209) 100%)',
  },
  {
    id: 'lavender',
    css: 'radial-gradient(90% 80% at 25% 20%,oklch(100% 0 none / 0.5) 0%,transparent 55%),radial-gradient(110% 100% at 80% 90%,oklch(66.15% 0.193 288.88 / 0.55) 0%,transparent 60%),linear-gradient(150deg,oklch(94.14% 0.033 300.93) 0%,oklch(81.39% 0.09 298.22) 55%,oklch(66.56% 0.15 294.01) 100%)',
  },
  {
    id: 'arctic',
    css: 'radial-gradient(100% 90% at 80% 15%,oklch(100% 0 none / 0.6) 0%,transparent 55%),radial-gradient(120% 120% at 10% 100%,oklch(78.09% 0.117 247.81 / 0.5) 0%,transparent 60%),linear-gradient(160deg,oklch(94.9% 0.027 241.15) 0%,oklch(84.66% 0.06 238.56) 55%,oklch(71.01% 0.09 243.88) 100%)',
  },
  {
    id: 'galaxy',
    css: 'radial-gradient(90% 90% at 75% 25%,oklch(67.97% 0.203 344.18 / 0.55) 0%,transparent 55%),radial-gradient(100% 100% at 20% 80%,oklch(59.18% 0.222 271.46 / 0.55) 0%,transparent 60%),linear-gradient(155deg,oklch(15.92% 0.043 280.27) 0%,oklch(23.1% 0.08 286.69) 55%,oklch(28.6% 0.114 288.49) 100%)',
  },
  {
    id: 'moss',
    css: 'radial-gradient(100% 80% at 20% 20%,oklch(93.88% 0.145 131.26 / 0.5) 0%,transparent 55%),radial-gradient(120% 120% at 90% 100%,oklch(41.69% 0.0846 160.11 / 0.6) 0%,transparent 60%),linear-gradient(160deg,oklch(29.71% 0.056 152.42) 0%,oklch(46.99% 0.102 153.81) 55%,oklch(63.39% 0.123 155.84) 100%)',
  },
  {
    id: 'coral',
    css: 'radial-gradient(90% 80% at 25% 15%,oklch(91.22% 0.097 85.91 / 0.55) 0%,transparent 55%),radial-gradient(110% 110% at 85% 95%,oklch(69.41% 0.2 13.27 / 0.55) 0%,transparent 60%),linear-gradient(150deg,oklch(90.43% 0.084 77.47) 0%,oklch(78.3% 0.131 40.28) 50%,oklch(69.18% 0.188 4.16) 100%)',
  },
  {
    id: 'midnight',
    css: 'radial-gradient(120% 90% at 80% 20%,oklch(66.18% 0.179 264.38 / 0.4) 0%,transparent 55%),radial-gradient(100% 100% at 15% 90%,oklch(38.05% 0.102 273.47 / 0.5) 0%,transparent 60%),linear-gradient(165deg,oklch(12.64% 0.022 276.42) 0%,oklch(20.52% 0.055 274.35) 55%,oklch(27.69% 0.083 272.32) 100%)',
  },
];

const ALL_PRESETS: readonly CoverPreset[] = [...COVER_GRADIENTS, ...COVER_SCENES];

export function isGradientCover(v: string | null | undefined): boolean {
  return typeof v === 'string' && v.startsWith(GRADIENT_PREFIX);
}

export function gradientToken(id: string): string {
  return `${GRADIENT_PREFIX}${id}`;
}

function presetCss(v: string): string {
  const id = v.slice(GRADIENT_PREFIX.length);
  return ALL_PRESETS.find((g) => g.id === id)?.css ?? COVER_GRADIENTS[0]!.css;
}

// Inline-стиль фона обложки: пресет (градиент/сцена — позиция не важна) или картинка с
// вертикальной позицией.
export function coverStyle(coverUrl: string, positionPct: number): CSSProperties {
  if (isGradientCover(coverUrl)) {
    return { backgroundImage: presetCss(coverUrl) };
  }
  return {
    backgroundImage: `url("${coverUrl}")`,
    backgroundSize: 'cover',
    backgroundPosition: `center ${positionPct}%`,
    backgroundRepeat: 'no-repeat',
  };
}

// Превью для плитки пресета в галерее.
export function presetTileStyle(css: string): CSSProperties {
  return { backgroundImage: css };
}

// «Добавить обложку» ставит случайную арт-сцену (выглядит богаче простого градиента).
export function randomCover(): string {
  const i = Math.floor(Math.random() * COVER_SCENES.length);
  return gradientToken(COVER_SCENES[i]!.id);
}
