export type ScheduleDay = 0 | 1 | 2 | 3 | 4 | 5 | 6;

// Values match JavaScript Date#getDay; presentation order is Monday through Sunday.
export const ALL_SCHEDULE_DAYS: readonly ScheduleDay[] = [1, 2, 3, 4, 5, 6, 0];

export const SCHEDULE_DAY_OPTIONS: readonly { value: ScheduleDay; label: string }[] = [
  { value: 1, label: 'Пн' },
  { value: 2, label: 'Вт' },
  { value: 3, label: 'Ср' },
  { value: 4, label: 'Чт' },
  { value: 5, label: 'Пт' },
  { value: 6, label: 'Сб' },
  { value: 0, label: 'Вс' },
];
