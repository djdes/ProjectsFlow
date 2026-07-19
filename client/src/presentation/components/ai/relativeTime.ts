const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export const RECENCY_GROUP_ORDER = ['Сегодня', 'Прошлая неделя', 'Последние 30 дней', 'Ранее'] as const;

export type RecencyGroupLabel = (typeof RECENCY_GROUP_ORDER)[number];

function startOfDay(time: number): number {
  const date = new Date(time);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function formatDate(time: number, now: number): string {
  const date = new Date(time);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  const formatted = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(date);
  // ICU отдаёт сокращения месяцев то с точкой («13 июл.»), то без — в зависимости от версии
  // рантайма, а к году в ru-RU дописывает « г.». Чистим, чтобы вывод был компактным и не
  // зависел от сборки Node/браузера.
  return formatted.replace(/\s*г\.?$/, '').replace(/\./g, '').trim();
}

/**
 * «сейчас» → «12 мин» → «20 ч» → «2 д» → «13 июл». Всегда считается от переданного `now`:
 * значение нельзя кешировать в состоянии, иначе «сейчас» залипнет на часы.
 */
export function formatRelativeTime(time: number, now: number = Date.now()): string {
  const delta = Math.max(0, now - time);
  if (delta < MINUTE_MS) return 'сейчас';
  if (delta < HOUR_MS) return `${Math.floor(delta / MINUTE_MS)} мин`;
  if (delta < DAY_MS) return `${Math.floor(delta / HOUR_MS)} ч`;
  const days = Math.floor(delta / DAY_MS);
  if (days < 7) return `${days} д`;
  return formatDate(time, now);
}

/**
 * Группа истории. Границы считаются по календарным суткам, а не по прошедшим миллисекундам:
 * вчерашний вечерний чат должен уходить из «Сегодня» на смене даты, а не через 24 часа.
 */
export function recencyGroupLabel(time: number, now: number = Date.now()): RecencyGroupLabel {
  const days = Math.max(0, Math.floor((startOfDay(now) - startOfDay(time)) / DAY_MS));
  if (days === 0) return 'Сегодня';
  if (days <= 7) return 'Прошлая неделя';
  if (days <= 30) return 'Последние 30 дней';
  return 'Ранее';
}

export function groupByRecency<T>(
  items: readonly T[],
  timeOf: (item: T) => number,
  now: number = Date.now(),
): Array<{ label: RecencyGroupLabel; items: T[] }> {
  const buckets = new Map<RecencyGroupLabel, T[]>();
  for (const item of items) {
    const label = recencyGroupLabel(timeOf(item), now);
    const bucket = buckets.get(label);
    if (bucket) bucket.push(item);
    else buckets.set(label, [item]);
  }
  return RECENCY_GROUP_ORDER.map((label) => ({ label, items: buckets.get(label) ?? [] })).filter(
    (group) => group.items.length > 0,
  );
}
