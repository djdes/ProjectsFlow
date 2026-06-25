// Shared date/time formatting helpers (ru-RU). Keep all human-facing date strings here
// so format stays consistent across the app.

const TASK_CREATED_FMT = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** Дата создания задачи в формате через точку: "25.06.2026, 14:30". */
export function formatTaskCreated(date: Date): string {
  return TASK_CREATED_FMT.format(date);
}
