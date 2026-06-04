import { cn } from '@/lib/utils';
import { PRIORITY_META } from '@/domain/task/priorityMeta';
import type { TaskPriority } from '@/domain/task/Task';

type Props = {
  priority: TaskPriority;
  className?: string;
};

// Маленький бейдж приоритета: цветной dot + P1..P4. Используется на карточках
// (Kanban + List). Цвет берётся из PRIORITY_META.
export function PriorityBadge({ priority, className }: Props): React.ReactElement {
  const meta = PRIORITY_META[priority];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full bg-card/60 px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal',
        meta.textColor,
        className,
      )}
      title={`Приоритет: ${meta.label}`}
    >
      <span className={cn('size-2 rounded-full', meta.dotColor)} aria-hidden />
      {meta.label}
    </span>
  );
}
