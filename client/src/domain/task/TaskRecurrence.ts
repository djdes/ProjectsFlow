// Повтор задачи (db/185), Todoist-style «every». Mirrors server/src/domain/task/TaskRecurrence.ts.
// Следующую задачу ставит сервер, когда повторяющуюся задачу выполняют; клиент только
// показывает и меняет правило.

// Дни недели по ISO 8601: 1 = понедельник … 7 = воскресенье.
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const ISO_WEEKDAYS: readonly IsoWeekday[] = [1, 2, 3, 4, 5, 6, 7];

export type TaskRecurrence =
  | { readonly kind: 'daily' }
  | { readonly kind: 'weekdays' }
  | { readonly kind: 'weekly'; readonly days: readonly IsoWeekday[] }
  // Число месяца 1..31; в коротком месяце — его последний день.
  | { readonly kind: 'monthly'; readonly day: number };

export type TaskRecurrenceKind = TaskRecurrence['kind'];

export const TASK_RECURRENCE_KINDS: readonly TaskRecurrenceKind[] = ['daily', 'weekdays', 'weekly', 'monthly'];

export const WEEKDAY_SHORT: Record<IsoWeekday, string> = {
  1: 'пн', 2: 'вт', 3: 'ср', 4: 'чт', 5: 'пт', 6: 'сб', 7: 'вс',
};

export const WEEKDAY_FULL: Record<IsoWeekday, string> = {
  1: 'Понедельник',
  2: 'Вторник',
  3: 'Среда',
  4: 'Четверг',
  5: 'Пятница',
  6: 'Суббота',
  7: 'Воскресенье',
};

// Подписи пунктов выбора (без деталей правила).
export const TASK_RECURRENCE_KIND_LABEL: Record<TaskRecurrenceKind, string> = {
  daily: 'Каждый день',
  weekdays: 'По будням',
  weekly: 'Каждую неделю',
  monthly: 'Каждый месяц',
};

function isoParts(iso: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(iso);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function isoWeekdayOf(iso: string): IsoWeekday {
  const parts = isoParts(iso);
  if (!parts) return 1;
  const js = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).getUTCDay();
  return (js === 0 ? 7 : js) as IsoWeekday;
}

export function dayOfMonthOf(iso: string): number {
  return isoParts(iso)?.[2] ?? 1;
}

/** Дата-якорь правила: срок задачи, а без срока — сегодняшняя (локальная) дата. */
export function recurrenceAnchorDate(deadline: string | null | undefined, now: Date): string {
  if (deadline && isoParts(deadline)) return deadline;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Правило выбранного вида, привязанное к дате-якорю (срок задачи или сегодня): «каждую
 * неделю» — в день недели якоря, «каждый месяц» — в его число. Так выбор одним тапом
 * сразу совпадает с тем, что человек видит в сроке.
 */
export function taskRecurrenceForKind(kind: TaskRecurrenceKind, anchorIso: string): TaskRecurrence {
  switch (kind) {
    case 'daily':
      return { kind: 'daily' };
    case 'weekdays':
      return { kind: 'weekdays' };
    case 'weekly':
      return { kind: 'weekly', days: [isoWeekdayOf(anchorIso)] };
    case 'monthly':
      return { kind: 'monthly', day: dayOfMonthOf(anchorIso) };
  }
}

/** Переключить день недели в недельном правиле. Последний день не снимается. */
export function toggleRecurrenceWeekday(
  rule: Extract<TaskRecurrence, { kind: 'weekly' }>,
  day: IsoWeekday,
): Extract<TaskRecurrence, { kind: 'weekly' }> {
  const has = rule.days.includes(day);
  if (has && rule.days.length === 1) return rule;
  const days = has ? rule.days.filter((d) => d !== day) : [...rule.days, day];
  return { kind: 'weekly', days: [...days].sort((a, b) => a - b) };
}

/** «Каждый день» / «По будням» / «Каждую неделю: пн, чт» / «Каждый месяц, 31-го». */
export function taskRecurrenceLabel(rule: TaskRecurrence): string {
  switch (rule.kind) {
    case 'daily':
    case 'weekdays':
      return TASK_RECURRENCE_KIND_LABEL[rule.kind];
    case 'weekly':
      return rule.days.length === 7
        ? 'Каждую неделю: все дни'
        : `Каждую неделю: ${rule.days.map((d) => WEEKDAY_SHORT[d]).join(', ')}`;
    case 'monthly':
      return `Каждый месяц, ${rule.day}-го`;
  }
}

export function sameTaskRecurrence(
  a: TaskRecurrence | null | undefined,
  b: TaskRecurrence | null | undefined,
): boolean {
  if (!a || !b) return !a && !b;
  if (a.kind !== b.kind) return false;
  if (a.kind === 'weekly' && b.kind === 'weekly') return a.days.join(',') === b.days.join(',');
  if (a.kind === 'monthly' && b.kind === 'monthly') return a.day === b.day;
  return true;
}
