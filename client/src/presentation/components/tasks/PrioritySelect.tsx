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
  // Icon-only режим для композеров: флажок (цветной, когда приоритет задан), label в title.
  iconOnly?: boolean;
};

// Dropdown выбора приоритета. 5 опций: «Без приоритета» (null) + P1..P4.
// Trigger показывает цветной дот + краткий label (P1/P2/...) или «Приоритет».
export function PrioritySelect({
  value,
  onChange,
  disabled,
  className,
  compact = false,
  iconOnly = false,
}: Props): React.ReactElement {
  const meta = value !== null ? PRIORITY_META[value] : null;

  // Ряд свойств задачи (TaskDrawer) передаёт PROPERTY_VALUE_CLASS с `justify-start` —
  // там без флажка-иконки и с плейсхолдером «Выбрать…». В остальных местах (AddTaskDialog,
  // bulk) оставляем флажок + «Без приоритета».
  const inPropertyRow = (className ?? '').includes('justify-start');

  if (iconOnly) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled}
            className={cn(
              'shrink-0',
              meta ? meta.textColor : 'text-muted-foreground hover:text-foreground',
              className,
            )}
            title={meta ? `Приоритет: ${meta.label}` : 'Приоритет'}
            aria-label={meta ? `Приоритет: ${meta.label}` : 'Приоритет'}
          >
            <Flag className="size-4" fill={meta ? 'currentColor' : 'none'} />
          </Button>
        </DropdownMenuTrigger>
        <PriorityMenuContent value={value} onChange={onChange} />
      </DropdownMenu>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant={compact ? 'ghost' : 'outline'}
          size="sm"
          disabled={disabled}
          className={cn(
            inPropertyRow ? '' : 'h-7 gap-1.5 px-2 text-xs',
            className,
            !meta && 'text-muted-foreground hover:text-foreground',
            meta && meta.textColor,
          )}
          title="Приоритет задачи"
        >
          {/* В ряду свойств — без ведущего значка (ни дота, ни флажка), чтобы значение
              начиналось ровно на одной вертикали с остальными пунктами. */}
          {!inPropertyRow &&
            (meta ? (
              <span className={cn('size-2 rounded-full', meta.dotColor)} aria-hidden />
            ) : (
              <Flag className="size-3.5" />
            ))}
          {meta ? meta.label : inPropertyRow ? 'Выбрать приоритет…' : 'Без приоритета'}
          {!inPropertyRow && <ChevronDown className="size-3" />}
        </Button>
      </DropdownMenuTrigger>
      <PriorityMenuContent value={value} onChange={onChange} />
    </DropdownMenu>
  );
}

// Общее содержимое dropdown'а — для обычного и icon-only триггеров.
function PriorityMenuContent({
  value,
  onChange,
}: {
  value: TaskPriority | null;
  onChange: (next: TaskPriority | null) => void;
}): React.ReactElement {
  return (
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
          </DropdownMenuItem>
        );
      })}
    </DropdownMenuContent>
  );
}
