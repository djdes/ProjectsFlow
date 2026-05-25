import { useState, type KeyboardEvent } from 'react';
import { GitCommit, ImageIcon, Loader2, MessageSquare, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import type { Task, TaskStatus } from '@/domain/task/Task';
import { taskShortId } from '@/domain/task/Task';
import { useTasks } from '@/presentation/hooks/useTasks';
import { TaskDrawer, type TaskDrawerState } from './TaskDrawer';
import { RalphModeBadge } from './RalphMode';

const STATUS_ORDER: Record<TaskStatus, number> = {
  backlog: -1,
  todo: 0,
  in_progress: 1,
  // awaiting_clarification сидит между in_progress и done в пайплайне.
  awaiting_clarification: 1.5,
  done: 2,
};

type Props = {
  projectId: string;
  // Если false — скрываем UI коммит-привязки: секцию в диалоге, short-id в строках/заголовке.
  // Для inbox-проекта так: у него нет git-репо, привязывать нечего.
  showCommits?: boolean;
};

// Плоский список задач — альтернатива канбану. UX заточен под inbox: на самом верху
// quick-add (Enter сразу создаёт), ниже плоский список без секций. Done-задачи
// перечёркиваются. Для аттачей/коммитов — клик по строке открывает диалог.
export function TaskListView({ projectId, showCommits = true }: Props): React.ReactElement {
  const { tasks, loading, error, create, update, remove, refetch } = useTasks(projectId);
  const [dialog, setDialog] = useState<TaskDrawerState | null>(null);

  // Сортируем по статусу (todo → in_progress → done), внутри статуса — по position.
  // Это даёт «открытые наверху, готовые внизу» без явных section-заголовков.
  const sorted = [...tasks].sort((a, b) => {
    const s = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (s !== 0) return s;
    return a.position - b.position;
  });

  const handleDialogSubmit = async (input: {
    description: string;
    ralphMode?: import('@/domain/task/Task').RalphMode;
  }): Promise<Task> => {
    if (!dialog) throw new Error('Dialog state missing');
    if (dialog.mode === 'create') return create({ ...input, status: dialog.status });
    return update(dialog.task.id, input);
  };

  const handleQuickAdd = async (description: string): Promise<void> => {
    try {
      await create({ description, status: 'todo' });
    } catch (e) {
      toast.error(`Не удалось создать: ${(e as Error).message}`);
      throw e;
    }
  };

  const handleDelete = async (task: Task): Promise<void> => {
    const preview = (task.description ?? '').split('\n')[0]?.slice(0, 60) ?? '';
    const label = preview.length > 0 ? `"${preview}${preview.length === 60 ? '…' : ''}"` : 'задачу';
    if (!window.confirm(`Удалить ${label}?`)) return;
    try {
      await remove(task.id);
      toast.success('Задача удалена');
    } catch (err) {
      toast.error(`Не удалось удалить: ${(err as Error).message}`);
    }
  };

  if (loading) {
    return (
      <div className="space-y-2">
        <div className="h-14 animate-pulse rounded-lg bg-muted" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-12 animate-pulse rounded-md bg-muted" />
        ))}
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  return (
    <div className="space-y-3">
      <QuickAddInput onSubmit={handleQuickAdd} />

      {sorted.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/20 py-12 text-center text-sm text-muted-foreground">
          Пусто. Напиши что-нибудь сверху и&nbsp;нажми&nbsp;Enter.
        </div>
      ) : (
        <ul className="divide-y overflow-hidden rounded-lg border bg-card">
          {sorted.map((t) => (
            <TaskListRow
              key={t.id}
              task={t}
              showShortId={showCommits}
              onEdit={() => setDialog({ mode: 'edit', task: t })}
              onDelete={() => handleDelete(t)}
            />
          ))}
        </ul>
      )}

      <TaskDrawer
        state={dialog}
        onClose={() => setDialog(null)}
        onSubmit={handleDialogSubmit}
        onCommitsChange={() => void refetch()}
        showCommits={showCommits}
      />
    </div>
  );
}

// Inline-input для быстрого добавления. Enter — submit, Shift+Enter — newline.
// После submit поле очищается и фокус остаётся — можно сразу набивать следующую.
function QuickAddInput({
  onSubmit,
}: {
  onSubmit: (description: string) => Promise<void>;
}): React.ReactElement {
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (): Promise<void> => {
    const trimmed = value.trim();
    if (trimmed.length === 0 || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(trimmed);
      setValue('');
    } catch {
      // ошибка показана в toast в caller'е; поле не чистим чтоб юзер мог поправить
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  return (
    <div className="relative rounded-lg border bg-card transition-colors focus-within:border-foreground/30 focus-within:bg-background">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={1}
        autoFocus
        disabled={submitting}
        placeholder="Что нужно сделать? Enter — добавить, Shift+Enter — новая строка"
        className="block w-full resize-none rounded-lg bg-transparent px-4 py-3 text-sm leading-snug placeholder:text-muted-foreground/70 focus:outline-none disabled:opacity-50"
      />
      {submitting && (
        <Loader2 className="absolute right-3 top-3.5 size-4 animate-spin text-muted-foreground" />
      )}
    </div>
  );
}

function TaskListRow({
  task,
  showShortId,
  onEdit,
  onDelete,
}: {
  task: Task;
  showShortId: boolean;
  onEdit: () => void;
  onDelete: () => void;
}): React.ReactElement {
  const isDone = task.status === 'done';
  const hasBadges =
    (task.commitCount ?? 0) > 0 ||
    (task.attachmentCount ?? 0) > 0 ||
    (task.commentCount ?? 0) > 0 ||
    task.ralphMode !== 'normal';

  return (
    <li
      className="group flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
      onClick={onEdit}
    >
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'line-clamp-2 whitespace-pre-wrap text-sm leading-snug',
            isDone && 'text-muted-foreground line-through decoration-muted-foreground/40',
          )}
        >
          {task.description ?? '—'}
        </p>
        {hasBadges && (
          <div className="mt-1.5 flex items-center gap-2 text-[10px] text-muted-foreground">
            {showShortId && (
              <span className="font-mono opacity-60">[{taskShortId(task.id)}]</span>
            )}
            {(task.commitCount ?? 0) > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-blue-500/15 px-1.5 py-0.5 text-blue-600 dark:bg-blue-400/15 dark:text-blue-400">
                <GitCommit className="size-2.5" />
                {task.commitCount}
              </span>
            )}
            {(task.attachmentCount ?? 0) > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-400">
                <ImageIcon className="size-2.5" />
                {task.attachmentCount}
              </span>
            )}
            {(task.commentCount ?? 0) > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-violet-500/15 px-1.5 py-0.5 text-violet-600 dark:bg-violet-400/15 dark:text-violet-400">
                <MessageSquare className="size-2.5" />
                {task.commentCount}
              </span>
            )}
            <RalphModeBadge mode={task.ralphMode} />
          </div>
        )}
      </div>
      <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          aria-label="Редактировать"
        >
          <Pencil className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-destructive hover:text-destructive"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          aria-label="Удалить"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </li>
  );
}
