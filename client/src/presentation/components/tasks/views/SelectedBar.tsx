import { X, Trash2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { TaskPriority, TaskStatus } from '@/domain/task/Task';
import { TASK_PRIORITIES } from '@/domain/task/Task';
import { PRIORITY_META } from '@/domain/task/priorityMeta';
import { VISIBLE_KANBAN_STATUSES } from '@/domain/kanban/KanbanSettings';
import { STATUS_LABEL } from '../statusLabels';
import { ymd, startOfDay, addDays } from '../assignedGrouping';
import { STATUS_DOT } from './viewShared';

// Плавающая панель действий над выбранными строками — копия Notion selection toolbar:
// «N выбрано ✕ | Статус | Приоритет | Срок | 🗑», плавает СВЕРХУ по центру.
// Общая для табличного и списочного видов.
export function SelectedBar({
  count,
  onExit,
  onStatus,
  onPriority,
  onDeadline,
  onDelete,
}: {
  count: number;
  onExit: () => void;
  onStatus: (s: TaskStatus) => void;
  onPriority: (p: TaskPriority | null) => void;
  onDeadline: (d: string | null) => void;
  onDelete: () => void;
}): React.ReactElement {
  const today = ymd(startOfDay(new Date()));
  return (
    <div
      role="toolbar"
      aria-label="Действия с выбранными задачами"
      className="fixed left-1/2 top-16 z-40 flex -translate-x-1/2 items-center overflow-hidden rounded-lg border bg-card shadow-lg duration-200 animate-in fade-in slide-in-from-top-2"
    >
      <span className="flex items-center gap-1.5 border-r px-2.5 py-1.5 text-xs font-medium text-primary">
        Выбрано: {count}
        <button type="button" aria-label="Снять выбор" onClick={onExit}>
          <X className="size-3.5 opacity-60 hover:opacity-100" />
        </button>
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="border-r px-2.5 py-1.5 text-xs transition-colors hover:bg-accent">
            Статус
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="min-w-[11rem]">
          {VISIBLE_KANBAN_STATUSES.map((s) => (
            <DropdownMenuItem key={s} className="gap-2" onClick={() => onStatus(s)}>
              <span className={cn('size-2 rounded-full', STATUS_DOT[s])} />
              {STATUS_LABEL[s]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="border-r px-2.5 py-1.5 text-xs transition-colors hover:bg-accent">
            Приоритет
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="min-w-[11rem]">
          {TASK_PRIORITIES.map((p) => (
            <DropdownMenuItem key={p} className="gap-2" onClick={() => onPriority(p)}>
              <span className={cn('size-2 rounded-full', PRIORITY_META[p].dotColor)} />
              {PRIORITY_META[p].label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-muted-foreground" onClick={() => onPriority(null)}>
            Без приоритета
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="border-r px-2.5 py-1.5 text-xs transition-colors hover:bg-accent">
            Срок
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="min-w-[11rem]">
          <DropdownMenuItem onClick={() => onDeadline(today)}>Сегодня</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onDeadline(ymd(addDays(startOfDay(new Date()), 1)))}>
            Завтра
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-muted-foreground" onClick={() => onDeadline(null)}>
            Убрать срок
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        type="button"
        aria-label="Удалить выбранные"
        title="Удалить выбранные"
        onClick={onDelete}
        className="px-2.5 py-1.5 text-destructive transition-colors hover:bg-destructive/10"
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );
}
