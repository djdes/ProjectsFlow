// Domain model for traffic of the PUBLISHED application (db/137). Pure: no HTTP/DB/DOM deps.
//
// This measures hits on the deployed site (<slug>.projectsflow.ru), deliberately distinct from
// project-card views (project_views). The design is anti-surveillance by construction — see the
// migration header — so the exposed shape is intentionally coarse: time-series counts plus a
// fixed 4-value platform bucket. There are NO per-value facets ("top paths", "top values") over
// application-controlled columns: a facet over app data would be an oracle (см. раздел 4 плана).

// Грубая классификация клиента. Считается сервером из User-Agent и хранится ВМЕСТО сырого UA,
// поэтому не даёт поверхности для фингерпринтинга. Фиксированный маленький набор — не фасет.
export type UaClass = 'desktop' | 'mobile' | 'bot' | 'other';

export const UA_CLASSES: readonly UaClass[] = ['desktop', 'mobile', 'bot', 'other'];

// Одна точка временного ряда. sessions — число РАЗЛИЧНЫХ session_hash за день (уникальные визиты),
// visits — все хиты. Это агрегаты по времени, не по значениям чувствительных колонок.
export type AppTrafficDay = {
  readonly date: string; // 'YYYY-MM-DD'
  readonly visits: number;
  readonly sessions: number;
};

export type AppTraffic = {
  readonly windowDays: number;
  readonly totalVisits: number;
  // Уникальные сессии за всё окно (НЕ сумма дневных distinct — session_hash ротируется по дню).
  readonly totalSessions: number;
  readonly perDay: readonly AppTrafficDay[];
  // Разбивка по грубым корзинам клиента. Не «топ значений» — фиксированный enum из UA_CLASSES.
  readonly byClass: Readonly<Record<UaClass, number>>;
};

export const DEFAULT_TRAFFIC_WINDOW_DAYS = 28;
export const MAX_TRAFFIC_WINDOW_DAYS = 90;

// Классификация User-Agent в грубую корзину. Сознательно простая: цель — не точная детекция
// устройства, а обезличенная агрегатная метрика без хранения сырого UA.
export function classifyUserAgent(userAgent: string | null | undefined): UaClass {
  const ua = (userAgent ?? '').toLowerCase();
  if (!ua) return 'other';
  if (/(bot|crawler|spider|crawl|slurp|bingpreview|facebookexternalhit|headless|monitor|pingdom|curl|wget|python-requests|axios|node-fetch)/.test(ua)) {
    return 'bot';
  }
  if (/(mobile|iphone|ipod|android|blackberry|iemobile|opera mini|windows phone)/.test(ua)) {
    // iPad подаёт desktop-UA в новых iOS — сознательно классифицируем как desktop.
    return 'mobile';
  }
  if (/(mozilla|chrome|safari|firefox|edge|opera|gecko|webkit)/.test(ua)) {
    return 'desktop';
  }
  return 'other';
}

// Нормализация пути: только pathname, без query/fragment (query может нести секреты — не храним).
// Пустое/невалидное → '/'. Ограничение длины — граница раздувания строки.
export function normalizeVisitPath(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim() === '') return '/';
  let candidate = raw.trim();
  // Отсекаем query и fragment ДО любой интерпретации.
  candidate = candidate.split('#')[0]!.split('?')[0]!;
  // Принимаем как абсолютный URL, так и просто путь.
  try {
    if (/^https?:\/\//i.test(candidate)) {
      candidate = new URL(candidate).pathname;
    }
  } catch {
    return '/';
  }
  if (!candidate.startsWith('/')) candidate = `/${candidate}`;
  return candidate.slice(0, 512);
}
