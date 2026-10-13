/** Monday–Wednesday: this Sunday; Thursday–Sunday: next Sunday, in local time. */
export function getDefaultTaskDeadline(now: Date = new Date()): string {
  const weekDay = (now.getDay() + 6) % 7;
  const due = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 6 - weekDay + (weekDay >= 3 ? 7 : 0));
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${due.getFullYear()}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}`;
}

/** Only unambiguous date filters override the usual planning horizon. Never create overdue work by default. */
export function getTaskCreationDeadline(filter?: 'today' | 'none' | 'week' | 'overdue' | 'has' | null, now: Date = new Date()): string | null {
  if (filter === 'none') return null;
  if (filter === 'today' || filter === 'week') {
    const due = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (filter === 'week') due.setDate(due.getDate() + (7 - due.getDay()) % 7);
    const pad = (value: number): string => String(value).padStart(2, '0');
    return `${due.getFullYear()}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}`;
  }
  return getDefaultTaskDeadline(now);
}
