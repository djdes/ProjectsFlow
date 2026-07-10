import { AlertTriangle, CalendarClock } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TaskStatus } from '@/domain/task/Task';

type Props = {
  deadline: string;             // ISO 'YYYY-MM-DD'
  status: TaskStatus;            // 'done' → не считаем просроченным
  className?: string;
};

// Считаем "сегодня" в локальном TZ как 'YYYY-MM-DD'. Это согласуется со
// строковым форматом deadline'а — никаких new Date(deadline) с дрейфом.
function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Русская плюрализация «день/дня/дней» по числу.
function ruDays(n: number): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return 'дней';
  if (b === 1) return 'день';
  if (b >= 2 && b <= 4) return 'дня';
  return 'дней';
}

// Срок компактно: сегодня / завтра / вчера / «N дней». БЕЗ «через/назад» — направление читается
// цветом бейджа (красный = просрочено, серый = впереди), см. DeadlineBadge. Абсолютную дату не
// показываем (полная дата — в title-тултипе).
function formatDeadline(deadline: string): string {
  // Парсим 'YYYY-MM-DD' как локальную дату (без UTC-сдвига): new Date(y, m-1, d).
  const [y, m, d] = deadline.split('-').map(Number);
  if (!y || !m || !d) return deadline;
  const date = new Date(y, m - 1, d);
  // diff в днях в локальном TZ (полночь-к-полночи) — без дрейфа через timestamp/DST.
  const diff = Math.round((date.getTime() - new Date().setHours(0, 0, 0, 0)) / DAY_MS);
  if (diff === 0) return 'сегодня';
  if (diff === 1) return 'завтра';
  if (diff === -1) return 'вчера';
  return `${Math.abs(diff)} ${ruDays(diff)}`;
}

// Бейдж со сроком: иконка часов + дата (relative для близких / Intl для дальних).
// Обычный срок — монохром (шум не нужен); просроченный и task не done — красная
// пилюля + AlertTriangle (единственный «громкий» случай).
export function DeadlineBadge({ deadline, status, className }: Props): React.ReactElement {
  const overdue = status !== 'done' && deadline < todayIso();
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[11px] font-medium',
        overdue
          ? 'rounded-full bg-rose-500/15 px-1.5 py-0.5 text-rose-600 dark:bg-rose-400/15 dark:text-rose-400'
          : 'text-muted-foreground',
        className,
      )}
      title={`Срок: ${deadline}${overdue ? ' (просрочено)' : ''}`}
    >
      {overdue ? (
        <AlertTriangle className="size-2.5" />
      ) : (
        <CalendarClock className="size-2.5" />
      )}
      {formatDeadline(deadline)}
    </span>
  );
}
