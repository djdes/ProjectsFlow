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

// Точная дата+время до секунды (Notion-style тултип на «N назад»): "4 июля 2026 г., 18:23:22".
const EXACT_DT_FMT = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

export function formatExactDateTime(date: Date): string {
  return EXACT_DT_FMT.format(date);
}
