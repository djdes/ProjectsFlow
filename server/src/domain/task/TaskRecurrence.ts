import { moscowDateOnly } from '../time/moscowDate.js';

// Повтор задачи (db/185), Todoist-style «every»: когда повторяющуюся задачу выполняют,
// сервер ставит следующую с тем же текстом и сроком по правилу.
//
// Правило задаёт фиксированное множество календарных дат (каждый день / пн–пт / выбранные
// дни недели / одно число месяца). Следующий срок — ближайшая дата этого множества, строго
// позже и срока выполненной задачи, и сегодняшнего дня: просроченная ежедневная задача не
// рождает копию «на вчера», а выполненная заранее — не дублирует уже наступивший срок.
//
// Mirrors client/src/domain/task/TaskRecurrence.ts.

// Дни недели по ISO 8601: 1 = понедельник … 7 = воскресенье.
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const ISO_WEEKDAYS: readonly IsoWeekday[] = [1, 2, 3, 4, 5, 6, 7];

export type TaskRecurrence =
  | { readonly kind: 'daily' }
  // Только рабочие дни: пн–пт.
  | { readonly kind: 'weekdays' }
  // Выбранные дни недели (минимум один), отсортированы и без повторов.
  | { readonly kind: 'weekly'; readonly days: readonly IsoWeekday[] }
  // Одно число месяца (1..31). В коротком месяце — его последний день: «31-го» в феврале
  // даёт 28/29-е, а в марте снова 31-е (число хранится в правиле, срок не «сползает»).
  | { readonly kind: 'monthly'; readonly day: number };

export type TaskRecurrenceKind = TaskRecurrence['kind'];

function isIsoWeekday(value: unknown): value is IsoWeekday {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 7;
}

function isMonthDay(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 31;
}

/**
 * Приводит правило к каноническому виду (дни недели — по возрастанию, без повторов).
 * null — значение не является правилом повтора (пустой список дней, число вне 1..31,
 * неизвестный вид). Используется и на записи (API), и на чтении (БД).
 */
export function normalizeTaskRecurrence(value: unknown): TaskRecurrence | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as { kind?: unknown; days?: unknown; day?: unknown };
  switch (raw.kind) {
    case 'daily':
      return { kind: 'daily' };
    case 'weekdays':
      return { kind: 'weekdays' };
    case 'weekly': {
      if (!Array.isArray(raw.days)) return null;
      const days = [...new Set(raw.days)].filter(isIsoWeekday).sort((a, b) => a - b);
      if (days.length === 0 || days.length !== new Set(raw.days).size) return null;
      return { kind: 'weekly', days };
    }
    case 'monthly':
      return isMonthDay(raw.day) ? { kind: 'monthly', day: raw.day } : null;
    default:
      return null;
  }
}

/** Компактная строка для колонки tasks.recurrence: `daily`, `weekdays`, `weekly:1,3`, `monthly:31`. */
export function serializeTaskRecurrence(rule: TaskRecurrence | null | undefined): string | null {
  if (!rule) return null;
  switch (rule.kind) {
    case 'daily':
    case 'weekdays':
      return rule.kind;
    case 'weekly':
      return `weekly:${rule.days.join(',')}`;
    case 'monthly':
      return `monthly:${rule.day}`;
  }
}

/** Обратное к serializeTaskRecurrence. Битая строка (ручной UPDATE) читается как «не повторять». */
export function parseTaskRecurrence(raw: string | null | undefined): TaskRecurrence | null {
  if (!raw) return null;
  const [kind, arg] = raw.split(':', 2);
  if (kind === 'daily' || kind === 'weekdays') return arg === undefined ? { kind } : null;
  if (kind === 'weekly' && arg) {
    const parts = arg.split(',');
    if (!parts.every((p) => /^[1-7]$/u.test(p))) return null;
    return normalizeTaskRecurrence({ kind, days: parts.map(Number) });
  }
  if (kind === 'monthly' && arg && /^\d{1,2}$/u.test(arg)) {
    return normalizeTaskRecurrence({ kind, day: Number(arg) });
  }
  return null;
}

const WEEKDAY_SHORT: Record<IsoWeekday, string> = {
  1: 'пн', 2: 'вт', 3: 'ср', 4: 'чт', 5: 'пт', 6: 'сб', 7: 'вс',
};

/** Подпись правила для ленты изменений и уведомлений: «Каждую неделю: пн, чт». */
export function taskRecurrenceLabel(rule: TaskRecurrence): string {
  switch (rule.kind) {
    case 'daily':
      return 'Каждый день';
    case 'weekdays':
      return 'По будням';
    case 'weekly':
      return `Каждую неделю: ${rule.days.map((d) => WEEKDAY_SHORT[d]).join(', ')}`;
    case 'monthly':
      return `Каждый месяц, ${rule.day}-го числа`;
  }
}

export function sameTaskRecurrence(
  a: TaskRecurrence | null | undefined,
  b: TaskRecurrence | null | undefined,
): boolean {
  return serializeTaskRecurrence(a) === serializeTaskRecurrence(b);
}

// --- Календарная арифметика на датах 'YYYY-MM-DD' ---
// Считаем в «днях от эпохи» по UTC: у календарной даты нет часового пояса и перевода
// часов, поэтому шаг ровно в сутки здесь всегда корректен.

const DAY_MS = 24 * 60 * 60 * 1000;

function toEpochDay(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

function fromEpochDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

function isoWeekdayOf(day: number): IsoWeekday {
  const js = new Date(day * DAY_MS).getUTCDay(); // 0 = воскресенье
  return (js === 0 ? 7 : js) as IsoWeekday;
}

function daysInMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

// Число месяца из правила, прижатое к длине конкретного месяца.
function monthlyDate(year: number, month0: number, day: number): number {
  return Math.round(Date.UTC(year, month0, Math.min(day, daysInMonth(year, month0))) / DAY_MS);
}

// Ближайшая дата правила строго позже `after` (epoch day).
function firstMatchAfter(rule: TaskRecurrence, after: number): number {
  switch (rule.kind) {
    case 'daily':
      return after + 1;
    case 'weekdays': {
      let day = after + 1;
      while (isoWeekdayOf(day) > 5) day += 1;
      return day;
    }
    case 'weekly': {
      const allowed = new Set<IsoWeekday>(rule.days);
      // Правило валидно только с непустым списком дней, но и битое не должно зациклить.
      for (let day = after + 1; day <= after + 7; day += 1) {
        if (allowed.has(isoWeekdayOf(day))) return day;
      }
      return after + 7;
    }
    case 'monthly': {
      const start = new Date(after * DAY_MS);
      const year = start.getUTCFullYear();
      const month0 = start.getUTCMonth();
      const sameMonth = monthlyDate(year, month0, rule.day);
      if (sameMonth > after) return sameMonth;
      return monthlyDate(month0 === 11 ? year + 1 : year, (month0 + 1) % 12, rule.day);
    }
  }
}

/**
 * Срок следующего повтора, 'YYYY-MM-DD' (формат deadline в домене).
 *
 * `from` — срок выполненной задачи (или «сейчас», если срока не было), `today` — текущий
 * момент. Оба — моменты времени: берётся их календарная дата в зоне продукта
 * (Europe/Moscow), как и у дефолтного срока «сегодня» в CreateTask. Поэтому в 23:30 МСК
 * «сегодня» — уже московская дата, а не вчерашняя по UTC.
 *
 * Результат — ближайшая дата правила строго позже max(from, today): всегда в будущем.
 */
export function nextOccurrence(rule: TaskRecurrence, from: Date, today: Date): string {
  const fromDay = toEpochDay(moscowDateOnly(from));
  const todayDay = toEpochDay(moscowDateOnly(today));
  return fromEpochDay(firstMatchAfter(rule, Math.max(fromDay, todayDay)));
}

/**
 * Момент, чья московская дата равна дате 'YYYY-MM-DD'. Полдень UTC (15:00 МСК) — с запасом
 * от границ суток, так что дата не съезжает ни в какую сторону.
 */
export function instantOfDateOnly(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d, 12));
}

/** Срок следующего повтора по сроку выполненной задачи (null — считать от сегодня). */
export function nextOccurrenceAfterDeadline(
  rule: TaskRecurrence,
  deadline: string | null,
  now: Date,
): string {
  return nextOccurrence(rule, deadline ? instantOfDateOnly(deadline) : now, now);
}
