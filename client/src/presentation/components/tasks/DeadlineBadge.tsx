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

function formatDeadline(deadline: string): string {
  // Парсим 'YYYY-MM-DD' как локальную дату (без UTC-сдвига): new Date(y, m-1, d).
  const [y, m, d] = deadline.split('-').map(Number);
  if (!y || !m || !d) return deadline;
  const date = new Date(y, m - 1, d);

  const today = todayIso();
  if (deadline === today) return 'сегодня';
  // diff в днях в локальном TZ — округляем через iso-сравнение, не через timestamp
  // (DST не сдвинет).
  const diff = Math.round((date.getTime() - new Date().setHours(0, 0, 0, 0)) / DAY_MS);
  if (diff === 1) return 'завтра';
  if (diff === -1) return 'вчера';
  if (diff > 1 && diff <= 7) return `через ${diff} дн`;
  if (diff < -1 && diff >= -7) return `${Math.abs(diff)} дн назад`;
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

// Бейдж со сроком: иконка часов + дата (relative для близких / Intl для дальних).
// Если deadline прошёл и task не done — красный fg + AlertTriangle.
export function DeadlineBadge({ deadline, status, className }: Props): React.ReactElement {
  const overdue = status !== 'done' && deadline < todayIso();
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal',
        overdue
          ? 'bg-rose-500/15 text-rose-600 dark:bg-rose-400/15 dark:text-rose-400'
          : 'bg-amber-500/10 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300',
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
