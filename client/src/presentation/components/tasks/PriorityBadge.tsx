import { cn } from '@/lib/utils';
import { PRIORITY_META } from '@/domain/task/priorityMeta';
import type { TaskPriority } from '@/domain/task/Task';

type Props = {
  priority: TaskPriority;
  className?: string;
};

// Маленький бейдж приоритета: флажок-точка + подпись цветом приоритета, без подложки
// (дизайн C4: цвет — в метке, а не в заливке). Используется на карточках (Kanban, List,
// «Входящие»). Цвет берётся из PRIORITY_META.
export function PriorityBadge({ priority, className }: Props): React.ReactElement {
  const meta = PRIORITY_META[priority];
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-2xs font-medium normal-case tracking-normal',
        meta.textColor,
        className,
      )}
      title={`Приоритет: ${meta.label}`}
    >
      <span className={cn('size-1.5 rounded-full', meta.dotColor)} aria-hidden />
      {meta.label}
    </span>
  );
}
