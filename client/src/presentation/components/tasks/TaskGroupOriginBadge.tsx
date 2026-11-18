import type { ReactElement } from 'react';
import { MessagesSquare } from 'lucide-react';
import type { TaskGroupOrigin } from '@/domain/task/Task';
import { cn } from '@/lib/utils';

// Подпись «из группы «Скрипты»» (db/190): задачу поставили в рабочей Telegram-группе.
export function taskGroupOriginLabel(origin: TaskGroupOrigin): string {
  return origin.title ? `из группы «${origin.title}»` : 'из Telegram-группы';
}

// Подсказка: кто и когда поставил задачу в группе.
export function taskGroupOriginTooltip(origin: TaskGroupOrigin, createdAt: Date | null): string {
  const parts = [`Задача поставлена ${taskGroupOriginLabel(origin)}`];
  if (origin.authorName) parts.push(`Автор: ${origin.authorName}`);
  if (createdAt) {
    parts.push(
      new Intl.DateTimeFormat('ru-RU', {
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Moscow',
      }).format(createdAt),
    );
  }
  return parts.join('\n');
}

export function TaskGroupOriginBadge({
  origin,
  createdAt,
  className,
}: {
  origin: TaskGroupOrigin | null | undefined;
  createdAt?: Date | null;
  className?: string;
}): ReactElement | null {
  if (!origin) return null;
  return (
    <span
      className={cn(
        'inline-flex min-w-0 shrink-0 items-center gap-1 whitespace-nowrap rounded bg-sky-500/10 px-1.5 py-px text-sky-700 dark:text-sky-300',
        className,
      )}
      title={taskGroupOriginTooltip(origin, createdAt ?? null)}
      data-testid="task-group-origin"
    >
      <MessagesSquare className="size-3 shrink-0" aria-hidden="true" />
      <span className="truncate">{taskGroupOriginLabel(origin)}</span>
    </span>
  );
}
