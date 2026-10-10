import { AlertTriangle, Clock } from 'lucide-react';
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
// цветом (красный = просрочено, оранжевый = сегодня, серый = впереди). Абсолютную дату не
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

// Срок задачи (дизайн C4): часы + относительная дата, смысл — цветом текста без подложки.
// Просрочено — красный с треугольником (единственный «громкий» случай), сегодня — тёплый
// оранжевый, впереди — вторичный серый.
export function DeadlineBadge({ deadline, status, className }: Props): React.ReactElement {
  const today = todayIso();
  const overdue = status !== 'done' && deadline < today;
  const dueToday = status !== 'done' && deadline === today;
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-2xs',
        overdue ? 'font-medium text-destructive' : dueToday ? 'font-medium text-today' : 'text-muted-foreground',
        className,
      )}
      title={`Срок: ${deadline}${overdue ? ' (просрочено)' : ''}`}
    >
      {overdue ? <AlertTriangle className="size-3" /> : <Clock className="size-3" />}
      {formatDeadline(deadline)}
    </span>
  );
}
