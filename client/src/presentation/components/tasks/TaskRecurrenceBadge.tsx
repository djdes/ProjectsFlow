import { Repeat } from 'lucide-react';
import { cn } from '@/lib/utils';
import { taskRecurrenceLabel, type TaskRecurrence } from '@/domain/task/TaskRecurrence';

// Значок повтора на карточке задачи — рядом со сроком. Правило — в подсказке и для
// скринридера; цвет нейтральный: повтор не статус и не требует внимания.
export function TaskRecurrenceBadge({
  recurrence,
  className,
}: {
  recurrence: TaskRecurrence;
  className?: string;
}): React.ReactElement {
  const label = `Повторяется: ${taskRecurrenceLabel(recurrence).toLowerCase()}`;
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-pf-recurrence-badge
      className={cn('inline-flex shrink-0 items-center text-muted-foreground', className)}
    >
      <Repeat className="size-3" aria-hidden />
    </span>
  );
}
