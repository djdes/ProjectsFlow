import { mskNow } from './mskClock.js';

// Временная пауза плановых рассылок (сводки, EOD-напоминания, сверка коммитов): до этой
// МSK-даты планировщики молчат, с неё — работают как раньше. Тик во время паузы ничего не
// помечает отправленным, поэтому в первый день после паузы рассылки уходят в своё обычное время.
// Переопределяется через SCHEDULED_BROADCASTS_PAUSED_UNTIL=YYYY-MM-DD ('off' — снять паузу).
const DEFAULT_PAUSED_UNTIL = '2026-10-01';

export function resolvePausedUntil(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return DEFAULT_PAUSED_UNTIL;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

// true — плановые рассылки сейчас на паузе. Сравнение по МSK-дате: 'YYYY-MM-DD' сортируется лексически.
export function scheduledBroadcastsPaused(
  at: Date = new Date(),
  pausedUntil: string | null = resolvePausedUntil(process.env['SCHEDULED_BROADCASTS_PAUSED_UNTIL']),
): boolean {
  return pausedUntil !== null && mskNow(at).date < pausedUntil;
}
