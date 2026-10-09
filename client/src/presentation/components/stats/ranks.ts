// Цвета счётчика «выполнено сегодня»: ранг = число закрытых задач за день, каждый ранг —
// свой тон. Раньше рангу соответствовал ещё и набор декоративных деталей бейджа (трассы,
// HUD-скобки, реактор, дождь) — их убрали вместе с анимациями, остался только цвет.
//
// `ink` — тёмный тон того же семейства для надписи: белый текст на зелёном и бирюзе даёт
// контраст ~2:1, тёмный ~7:1.
export type Rank = {
  readonly n: number;
  readonly name: string;
  // Класс доступа: словами объясняет, почему цвет сменился.
  readonly grade: string;
  // c1 — основной тон, c2 — светлый (верх градиента), c3 — глубокий (низ).
  readonly c1: string;
  readonly c2: string;
  readonly c3: string;
  readonly ink: string;
};

export const RANKS: readonly Rank[] = [
  { n: 0, name: 'OFFLINE', grade: 'нет сигнала', c1: 'oklch(55.44% 0.041 257.42)', c2: 'oklch(71.07% 0.035 256.79)', c3: 'oklch(44.55% 0.037 257.28)', ink: 'oklch(92.88% 0.013 255.51)' },
  { n: 1, name: 'ONLINE', grade: 'terminal', c1: 'oklch(77.29% 0.1535 163.22)', c2: 'oklch(84.52% 0.13 164.98)', c3: 'oklch(69.59% 0.149 162.48)', ink: 'oklch(32.72% 0.066 164.88)' },
  { n: 2, name: 'SYNC', grade: 'terminal', c1: 'oklch(80.03% 0.182 151.71)', c2: 'oklch(87.12% 0.136 154.45)', c3: 'oklch(72.27% 0.192 149.58)', ink: 'oklch(32.82% 0.076 155.26)' },
  { n: 3, name: 'CACHE', grade: 'terminal', c1: 'oklch(78.45% 0.1325 181.91)', c2: 'oklch(85.49% 0.125 181.07)', c3: 'oklch(70.38% 0.123 182.5)', ink: 'oklch(33.45% 0.052 189.15)' },
  { n: 4, name: 'SCAN', grade: 'signal', c1: 'oklch(79.71% 0.134 211.53)', c2: 'oklch(86.51% 0.1153 207.08)', c3: 'oklch(71.48% 0.1257 215.22)', ink: 'oklch(34.21% 0.057 220.62)' },
  { n: 5, name: 'TRACE', grade: 'signal', c1: 'oklch(75.35% 0.139 232.66)', c2: 'oklch(82.76% 0.101 230.32)', c3: 'oklch(68.47% 0.1479 237.32)', ink: 'oklch(35.42% 0.076 239.65)' },
  { n: 6, name: 'CIPHER', grade: 'signal', c1: 'oklch(71.37% 0.143 254.62)', c2: 'oklch(80.91% 0.096 251.81)', c3: 'oklch(62.31% 0.188 259.81)', ink: 'oklch(33.92% 0.107 262.29)' },
  { n: 7, name: 'SHIFT', grade: 'data', c1: 'oklch(68.01% 0.158 276.93)', c2: 'oklch(78.53% 0.104 274.71)', c3: 'oklch(58.54% 0.204 277.12)', ink: 'oklch(32.32% 0.129 278.6)' },
  { n: 8, name: 'GLITCH', grade: 'data', c1: 'oklch(70.9% 0.159 293.54)', c2: 'oklch(81.12% 0.101 293.57)', c3: 'oklch(60.56% 0.219 292.72)', ink: 'oklch(34.07% 0.166 290.25)' },
  { n: 9, name: 'PROMPT', grade: 'neural', c1: 'oklch(72.17% 0.177 305.5)', c2: 'oklch(82.68% 0.108 306.38)', c3: 'oklch(62.68% 0.233 303.9)', ink: 'oklch(34.3% 0.154 302.85)' },
  { n: 10, name: 'STREAM', grade: 'neural', c1: 'oklch(74.77% 0.207 322.16)', c2: 'oklch(83.3% 0.132 321.43)', c3: 'oklch(66.68% 0.259 322.15)', ink: 'oklch(35.58% 0.144 323)' },
  { n: 11, name: 'GRID', grade: 'neural', c1: 'oklch(71.92% 0.169 13.43)', c2: 'oklch(80.97% 0.106 11.64)', c3: 'oklch(64.5% 0.215 16.44)', ink: 'oklch(35.18% 0.127 9.65)' },
  { n: 12, name: 'ROOT', grade: 'root', c1: 'oklch(87.9% 0.1534 91.61)', c2: 'oklch(94.51% 0.124 101.54)', c3: 'oklch(76.86% 0.1647 70.08)', ink: 'oklch(36.34% 0.08 59.25)' },
];

export const MAX_RANK = RANKS.length - 1;

// Выше 12 деталей больше нет: ранг остаётся ROOT, растёт только цифра. Расширять лестницу —
// значит придумывать новые детали, а не множить одинаковые.
export function rankFor(count: number): Rank {
  return RANKS[Math.min(Math.max(count, 0), MAX_RANK)]!;
}
