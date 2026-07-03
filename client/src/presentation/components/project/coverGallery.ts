import type { CSSProperties } from 'react';

// Обложка проекта (Notion-style). Значение project.coverUrl:
//  - `gradient:<id>` — градиент из палитры COVER_GRADIENTS ниже (чистый CSS, всегда работает);
//  - любой URL — картинка (внешняя ссылка / фото из галереи / загруженный файл
//    `/api/projects/:id/cover/...`). Позиция по вертикали — project.coverPosition (0–100 %).

export type CoverGradient = { readonly id: string; readonly css: string };
export type CoverPhoto = { readonly id: string; readonly url: string; readonly thumb: string };

const GRADIENT_PREFIX = 'gradient:';

// «Color & Gradient» — как в Notion. Чистый CSS, без внешних зависимостей.
export const COVER_GRADIENTS: readonly CoverGradient[] = [
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

// «Photos» — стабильные картинки Lorem Picsum по seed'у (хотлинк, без API-ключа).
const PHOTO_SEEDS = [
  'moonlight', 'aurora', 'canyon', 'ocean', 'forest', 'peaks',
  'desert', 'city', 'marble', 'ink', 'waves', 'dunes',
];
export const COVER_PHOTOS: readonly CoverPhoto[] = PHOTO_SEEDS.map((s) => ({
  id: s,
  url: `https://picsum.photos/seed/pf-${s}/1600/400`,
  thumb: `https://picsum.photos/seed/pf-${s}/240/120`,
}));

export function isGradientCover(v: string | null | undefined): boolean {
  return typeof v === 'string' && v.startsWith(GRADIENT_PREFIX);
}

export function gradientToken(id: string): string {
  return `${GRADIENT_PREFIX}${id}`;
}

function gradientCss(v: string): string {
  const id = v.slice(GRADIENT_PREFIX.length);
  return COVER_GRADIENTS.find((g) => g.id === id)?.css ?? COVER_GRADIENTS[0]!.css;
}

// Inline-стиль фона обложки: градиент (позиция не важна) или картинка с вертикальной позицией.
export function coverStyle(coverUrl: string, positionPct: number): CSSProperties {
  if (isGradientCover(coverUrl)) {
    return { backgroundImage: gradientCss(coverUrl) };
  }
  return {
    backgroundImage: `url("${coverUrl}")`,
    backgroundSize: 'cover',
    backgroundPosition: `center ${positionPct}%`,
    backgroundRepeat: 'no-repeat',
  };
}

// Превью для градиентной плитки в галерее.
export function gradientTileStyle(css: string): CSSProperties {
  return { backgroundImage: css };
}

// «Добавить обложку» ставит случайное ФОТО (как в Notion).
export function randomCover(): string {
  const i = Math.floor(Math.random() * COVER_PHOTOS.length);
  return COVER_PHOTOS[i]!.url;
}
