import type { ReactElement } from 'react';
import type { Task } from '@/domain/task/Task';
import { cn } from '@/lib/utils';
import { UserAvatarHover } from '@/presentation/components/user/UserAvatarHover';

export function TaskCreatedValue({
  task,
  dateLabel,
  className,
}: {
  task: Task;
  dateLabel: string;
  className?: string;
}): ReactElement {
  return (
    <span
      className={cn(
        'inline-flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground',
        className,
      )}
    >
      {task.creator && (
        <>
          <UserAvatarHover
            displayName={task.creator.displayName}
            avatarUrl={task.creator.avatarUrl}
            subtitle="Создатель"
            triggerClassName="size-5"
          />
          <span className="max-w-32 truncate text-foreground/80">{task.creator.displayName}</span>
          <span aria-hidden="true" className="text-muted-foreground/50">
            ·
          </span>
        </>
      )}
      <time dateTime={task.createdAt.toISOString()} className="whitespace-nowrap">
        {dateLabel}
      </time>
    </span>
  );
}
