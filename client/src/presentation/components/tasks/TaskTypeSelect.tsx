import { ChevronDown, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { TASK_TYPE_META } from '@/domain/task/taskTypeMeta';
import { TASK_TYPES, type TaskType } from '@/domain/task/Task';

type Props = {
  value: TaskType | null;
  onChange: (next: TaskType | null) => void;
  disabled?: boolean;
  className?: string;
  // Compact-режим: trigger без рамки (как у приоритета в ряду свойств).
  compact?: boolean;
};

// Dropdown выбора типа задачи: «Не определён» (null) + Фича/Баг. Зеркалит PrioritySelect,
// включая правило ряда свойств (justify-start → без ведущего значка и с плейсхолдером).
export function TaskTypeSelect({
  value,
  onChange,
  disabled,
  className,
  compact = false,
}: Props): React.ReactElement {
  const meta = value !== null ? TASK_TYPE_META[value] : null;
  const inPropertyRow = (className ?? '').includes('justify-start');

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
          title="Тип задачи"
        >
          {!inPropertyRow &&
            (meta ? (
              <span className={cn('size-2 rounded-full', meta.dotColor)} aria-hidden />
            ) : (
              <Tag className="size-3.5" />
            ))}
          {meta ? meta.label : inPropertyRow ? 'Выбрать тип…' : 'Без типа'}
          {!inPropertyRow && <ChevronDown className="size-3" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[180px]">
        <DropdownMenuItem onClick={() => onChange(null)}>
          <Tag className="size-3.5 text-muted-foreground" />
          Не определён
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {TASK_TYPES.map((t) => {
          const m = TASK_TYPE_META[t];
          return (
            <DropdownMenuItem
              key={t}
              onClick={() => onChange(t)}
              className={cn('gap-2', value === t && 'font-medium')}
            >
              <span className={cn('size-2.5 rounded-full', m.dotColor)} aria-hidden />
              <span>{m.label}</span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
