import { ArrowRight, PanelRightOpen, Trash2 } from 'lucide-react';
import type { Task, TaskStatus } from '@/domain/task/Task';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { plainTaskTitle } from '@/lib/taskTitleBody';

export type CardMoveTarget = { status: TaskStatus; label: string };

// Phone: a long press on a board card released in place opens this sheet (a long press that
// moves is still a drag). Same actions as the card's quick buttons, in reach of the thumb.
export function CardActionsSheet({
  task,
  targets,
  canEdit,
  onOpenChange,
  onOpenTask,
  onMove,
  onDelete,
}: {
  task: Task | null;
  targets: readonly CardMoveTarget[];
  canEdit: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenTask: (task: Task) => void;
  onMove: (task: Task, status: TaskStatus) => void;
  onDelete: (task: Task) => void;
}): React.ReactElement {
  const run = (action: () => void): void => {
    onOpenChange(false);
    action();
  };
  const rowClass =
    'flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-start text-sm transition-colors hover:bg-hover active:bg-active';
  return (
    <Dialog open={task !== null} onOpenChange={onOpenChange}>
      <DialogContent className="gap-2 sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="line-clamp-2">{task ? plainTaskTitle(task.description ?? '') : ''}</DialogTitle>
          <DialogDescription className="sr-only">Действия с задачей</DialogDescription>
        </DialogHeader>
        {task && (
          <div className="flex flex-col">
            <button type="button" className={rowClass} onClick={() => run(() => onOpenTask(task))}>
              <PanelRightOpen className="size-4 text-muted-foreground" />
              Открыть
            </button>
            {canEdit &&
              targets
                .filter((target) => target.status !== task.status)
                .map((target) => (
                  <button
                    key={target.status}
                    type="button"
                    className={rowClass}
                    onClick={() => run(() => onMove(task, target.status))}
                  >
                    <ArrowRight className="size-4 text-muted-foreground" />
                    {`В «${target.label}»`}
                  </button>
                ))}
            {canEdit && (
              <button
                type="button"
                className={`${rowClass} text-destructive`}
                onClick={() => run(() => onDelete(task))}
              >
                <Trash2 className="size-4" />
                Удалить
              </button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
