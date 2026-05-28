import { ChevronDown, Flag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { PRIORITY_META } from '@/domain/task/priorityMeta';
import { TASK_PRIORITIES, type TaskPriority } from '@/domain/task/Task';

type Props = {
  value: TaskPriority | null;
  onChange: (next: TaskPriority | null) => void;
  disabled?: boolean;
  className?: string;
  // Compact-режим: trigger показывает только дот + label без рамки fill-card.
  compact?: boolean;
};

// Dropdown выбора приоритета. 5 опций: «Без приоритета» (null) + P1..P4.
// Trigger показывает цветной дот + краткий label (P1/P2/...) или «Приоритет».
export function PrioritySelect({
  value,
  onChange,
  disabled,
  className,
  compact = false,
}: Props): React.ReactElement {
  const meta = value !== null ? PRIORITY_META[value] : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant={compact ? 'ghost' : 'outline'}
          size="sm"
          disabled={disabled}
          className={cn(
            'h-7 gap-1.5 px-2 text-xs',
            !meta && 'text-muted-foreground hover:text-foreground',
            meta && meta.textColor,
            className,
          )}
          title="Приоритет задачи"
        >
          {meta ? (
            <span className={cn('size-2 rounded-full', meta.dotColor)} aria-hidden />
          ) : (
            <Flag className="size-3.5" />
          )}
          {meta ? meta.label : 'Без приоритета'}
          <ChevronDown className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[180px]">
        <DropdownMenuItem onClick={() => onChange(null)}>
          <Flag className="size-3.5 text-muted-foreground" />
          Без приоритета
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {TASK_PRIORITIES.map((p) => {
          const m = PRIORITY_META[p];
          return (
            <DropdownMenuItem
              key={p}
              onClick={() => onChange(p)}
              className={cn('gap-2', value === p && 'font-medium')}
            >
              <span className={cn('size-2.5 rounded-full', m.dotColor)} aria-hidden />
              <span>{m.label}</span>
              <span className="ml-auto text-[10px] text-muted-foreground">{m.short}</span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
