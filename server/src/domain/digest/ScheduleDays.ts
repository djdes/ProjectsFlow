export type ScheduleDay = 0 | 1 | 2 | 3 | 4 | 5 | 6;

// UI order is Monday through Sunday, while values follow JavaScript Date#getDay.
export const ALL_SCHEDULE_DAYS: readonly ScheduleDay[] = [1, 2, 3, 4, 5, 6, 0];
export const WEEKDAY_SCHEDULE_DAYS: readonly ScheduleDay[] = [1, 2, 3, 4, 5];

export function normalizeScheduleDays(
  value: unknown,
  fallback: readonly ScheduleDay[] = ALL_SCHEDULE_DAYS,
): ScheduleDay[] {
  if (!Array.isArray(value)) return [...fallback];
  const selected = new Set<ScheduleDay>();
  for (const item of value) {
    if (Number.isInteger(item) && Number(item) >= 0 && Number(item) <= 6) {
      selected.add(Number(item) as ScheduleDay);
    }
  }
  const normalized = ALL_SCHEDULE_DAYS.filter((day) => selected.has(day));
  return normalized.length > 0 ? normalized : [...fallback];
}

export function isWeekdaysOnly(days: readonly ScheduleDay[]): boolean {
  return (
    days.length === WEEKDAY_SCHEDULE_DAYS.length &&
    WEEKDAY_SCHEDULE_DAYS.every((day) => days.includes(day))
  );
}
