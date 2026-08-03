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
  { n: 0, name: 'OFFLINE', grade: 'нет сигнала', c1: '#64748b', c2: '#94a3b8', c3: '#475569', ink: '#e2e8f0' },
  { n: 1, name: 'ONLINE', grade: 'terminal', c1: '#34d399', c2: '#6ee7b7', c3: '#10b981', ink: '#053f2c' },
  { n: 2, name: 'SYNC', grade: 'terminal', c1: '#4ade80', c2: '#86efac', c3: '#22c55e', ink: '#064023' },
  { n: 3, name: 'CACHE', grade: 'terminal', c1: '#2dd4bf', c2: '#5eead4', c3: '#14b8a6', ink: '#0c3f3c' },
  { n: 4, name: 'SCAN', grade: 'signal', c1: '#22d3ee', c2: '#67e8f9', c3: '#06b6d4', ink: '#0b3f4d' },
  { n: 5, name: 'TRACE', grade: 'signal', c1: '#38bdf8', c2: '#7dd3fc', c3: '#0ea5e9', ink: '#07405f' },
  { n: 6, name: 'CIPHER', grade: 'signal', c1: '#60a5fa', c2: '#93c5fd', c3: '#3b82f6', ink: '#17346e' },
  { n: 7, name: 'SHIFT', grade: 'data', c1: '#818cf8', c2: '#a5b4fc', c3: '#6366f1', ink: '#292573' },
  { n: 8, name: 'GLITCH', grade: 'data', c1: '#a78bfa', c2: '#c4b5fd', c3: '#8b5cf6', ink: '#3d1785' },
  { n: 9, name: 'PROMPT', grade: 'neural', c1: '#c084fc', c2: '#d8b4fe', c3: '#a855f7', ink: '#4a1678' },
  { n: 10, name: 'STREAM', grade: 'neural', c1: '#e879f9', c2: '#f0abfc', c3: '#d946ef', ink: '#5d1566' },
  { n: 11, name: 'GRID', grade: 'neural', c1: '#fb7185', c2: '#fda4af', c3: '#f43f5e', ink: '#6d0f2c' },
  { n: 12, name: 'ROOT', grade: 'root', c1: '#fcd34d', c2: '#fef08a', c3: '#f59e0b', ink: '#5c3208' },
];

export const MAX_RANK = RANKS.length - 1;

// Выше 12 деталей больше нет: ранг остаётся ROOT, растёт только цифра. Расширять лестницу —
// значит придумывать новые детали, а не множить одинаковые.
export function rankFor(count: number): Rank {
  return RANKS[Math.min(Math.max(count, 0), MAX_RANK)]!;
}
