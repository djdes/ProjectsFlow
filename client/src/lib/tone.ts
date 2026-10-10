// Тон метки — цвет из палитры Notion (см. .pf-tone-* в styles/globals.css). Проекту и
// человеку тон даётся по стабильному ключу (id), поэтому один и тот же проект везде одного
// цвета: в сайдбаре, в шапке колонки «Входящих», на метке карточки. Серый не раздаётся —
// он закреплён за «Личными» и всем нейтральным.
export type Tone =
  | 'gray'
  | 'brown'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'blue'
  | 'purple'
  | 'pink'
  | 'red';

const SEEDED_TONES: readonly Tone[] = [
  'orange',
  'green',
  'blue',
  'pink',
  'purple',
  'brown',
  'yellow',
  'red',
];

// Классы выписаны буквально: Tailwind ищет имена классов в исходниках, и собранная
// шаблонной строкой `pf-tone-${tone}` осталась бы для него невидимой.
const TONE_CLASS: Record<Tone, string> = {
  gray: 'pf-tone-gray',
  brown: 'pf-tone-brown',
  orange: 'pf-tone-orange',
  yellow: 'pf-tone-yellow',
  green: 'pf-tone-green',
  blue: 'pf-tone-blue',
  purple: 'pf-tone-purple',
  pink: 'pf-tone-pink',
  red: 'pf-tone-red',
};

export function toneOf(seed: string | null | undefined): Tone {
  const s = (seed ?? '').trim();
  if (!s) return 'gray';
  // Простой стабильный хеш (djb2-ish), >>>0 — чтобы остаться в uint32.
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return SEEDED_TONES[h % SEEDED_TONES.length]!;
}

export function toneClass(tone: Tone): string {
  return TONE_CLASS[tone];
}

// Тон проекта: «Личные» (инбокс) — всегда серые, остальные — по id.
export function projectToneClass(projectId: string, isInbox = false): string {
  return toneClass(isInbox ? 'gray' : toneOf(projectId));
}
