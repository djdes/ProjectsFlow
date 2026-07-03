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
  { id: 'rose', css: 'linear-gradient(135deg,#f093fb 0%,#f5576c 100%)' },
  { id: 'sunset', css: 'linear-gradient(135deg,#f6d365 0%,#fda085 100%)' },
  { id: 'peach', css: 'linear-gradient(135deg,#ffecd2 0%,#fcb69f 100%)' },
  { id: 'lime', css: 'linear-gradient(135deg,#d4fc79 0%,#96e6a1 100%)' },
  { id: 'mint', css: 'linear-gradient(135deg,#84fab0 0%,#8fd3f4 100%)' },
  { id: 'sky', css: 'linear-gradient(135deg,#a1c4fd 0%,#c2e9fb 100%)' },
  { id: 'ocean', css: 'linear-gradient(135deg,#4facfe 0%,#00f2fe 100%)' },
  { id: 'indigo', css: 'linear-gradient(135deg,#667eea 0%,#764ba2 100%)' },
  { id: 'grape', css: 'linear-gradient(135deg,#c471f5 0%,#fa71cd 100%)' },
  { id: 'night', css: 'linear-gradient(135deg,#30cfd0 0%,#330867 100%)' },
  { id: 'slate', css: 'linear-gradient(135deg,#647a8e 0%,#2c3440 100%)' },
  { id: 'blush', css: 'linear-gradient(135deg,#ff9a9e 0%,#fecfef 100%)' },
];

// «Обложки» — многослойные mesh-градиенты: читаются как абстрактные арт-сцены (небо, аврора,
// закат, океан, туманность). Тоже чистый CSS — грузятся мгновенно и не ломаются.
export const COVER_SCENES: readonly CoverPreset[] = [
  {
    id: 'aurora',
    css: 'radial-gradient(120% 80% at 18% 12%,rgba(79,172,254,.55) 0%,transparent 55%),radial-gradient(110% 90% at 82% 22%,rgba(167,112,239,.5) 0%,transparent 55%),radial-gradient(120% 120% at 60% 120%,rgba(0,242,254,.35) 0%,transparent 60%),linear-gradient(160deg,#0b1e3f 0%,#16305a 55%,#123 100%)',
  },
  {
    id: 'dusk',
    css: 'radial-gradient(100% 80% at 20% 100%,rgba(255,183,94,.6) 0%,transparent 55%),radial-gradient(120% 100% at 85% 15%,rgba(123,97,255,.55) 0%,transparent 60%),linear-gradient(180deg,#2a1a5e 0%,#5b2a86 45%,#c05e77 100%)',
  },
  {
    id: 'ember',
    css: 'radial-gradient(90% 90% at 30% 110%,rgba(255,94,58,.7) 0%,transparent 55%),radial-gradient(80% 80% at 80% 0%,rgba(255,193,94,.5) 0%,transparent 55%),linear-gradient(160deg,#1c0f12 0%,#3a1520 55%,#7a2233 100%)',
  },
  {
    id: 'ocean',
    css: 'radial-gradient(120% 90% at 15% 20%,rgba(120,255,214,.45) 0%,transparent 55%),radial-gradient(120% 120% at 85% 100%,rgba(0,90,160,.6) 0%,transparent 60%),linear-gradient(165deg,#04263b 0%,#0a4f6e 55%,#0e7c8a 100%)',
  },
  {
    id: 'lavender',
    css: 'radial-gradient(90% 80% at 25% 20%,rgba(255,255,255,.5) 0%,transparent 55%),radial-gradient(110% 100% at 80% 90%,rgba(146,120,255,.55) 0%,transparent 60%),linear-gradient(150deg,#efe7ff 0%,#c9b6f5 55%,#9a7fe6 100%)',
  },
  {
    id: 'arctic',
    css: 'radial-gradient(100% 90% at 80% 15%,rgba(255,255,255,.6) 0%,transparent 55%),radial-gradient(120% 120% at 10% 100%,rgba(120,190,255,.5) 0%,transparent 60%),linear-gradient(160deg,#dff1ff 0%,#a9d3f0 55%,#6fa8d6 100%)',
  },
  {
    id: 'galaxy',
    css: 'radial-gradient(90% 90% at 75% 25%,rgba(233,89,182,.55) 0%,transparent 55%),radial-gradient(100% 100% at 20% 80%,rgba(83,105,255,.55) 0%,transparent 60%),linear-gradient(155deg,#0a0a1f 0%,#1c1440 55%,#2b1a5e 100%)',
  },
  {
    id: 'moss',
    css: 'radial-gradient(100% 80% at 20% 20%,rgba(200,255,150,.5) 0%,transparent 55%),radial-gradient(120% 120% at 90% 100%,rgba(20,90,60,.6) 0%,transparent 60%),linear-gradient(160deg,#14351f 0%,#1f6b3f 55%,#3fa06a 100%)',
  },
  {
    id: 'coral',
    css: 'radial-gradient(90% 80% at 25% 15%,rgba(255,222,150,.55) 0%,transparent 55%),radial-gradient(110% 110% at 85% 95%,rgba(255,90,120,.55) 0%,transparent 60%),linear-gradient(150deg,#ffd9a0 0%,#ff9a76 50%,#f65f8e 100%)',
  },
  {
    id: 'midnight',
    css: 'radial-gradient(120% 90% at 80% 20%,rgba(90,140,255,.4) 0%,transparent 55%),radial-gradient(100% 100% at 15% 90%,rgba(50,60,120,.5) 0%,transparent 60%),linear-gradient(165deg,#05060f 0%,#101430 55%,#1b2350 100%)',
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
