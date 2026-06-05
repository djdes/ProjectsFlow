import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ImageIcon, Loader2, MessageSquare, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { Markdown, MARKDOWN_COMPACT } from '@/presentation/components/markdown/Markdown';
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu';
import { useTextFieldFormatting } from '@/presentation/hooks/useTextFieldFormatting';
import type { Task, TaskStatus } from '@/domain/task/Task';
import { useTasks } from '@/presentation/hooks/useTasks';
import { TaskDrawer, type TaskDrawerState } from './TaskDrawer';
import { RalphModeBadge } from './RalphMode';
import { InboxCheckbox } from './InboxCheckbox';
import { DelegationBadge } from './DelegationBadge';
import { DeadlineBadge } from './DeadlineBadge';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import { PRIORITY_META } from '@/domain/task/priorityMeta';
import { relativeTime } from '@/lib/relativeTime';

const STATUS_ORDER: Record<TaskStatus, number> = {
  backlog: -1,
  manual: -0.5,
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
  // Скрыть выполненные (status='done'). Toggle на странице InboxPage.
  hideDone?: boolean;
};

// Плоский список задач — альтернатива канбану. UX заточен под inbox: на самом верху
// quick-add (Enter сразу создаёт), ниже плоский список без секций. Done-задачи
// перечёркиваются. Для аттачей/коммитов — клик по строке открывает диалог.
export function TaskListView({ projectId, showCommits = true, hideDone = false }: Props): React.ReactElement {
  const { tasks, loading, error, create, update, remove, refetch } = useTasks(projectId);
  const { user } = useCurrentUser();
  const [dialog, setDialog] = useState<TaskDrawerState | null>(null);

  // Deep-link `?task=<id>` — открывает drawer задачи один раз после загрузки.
  // Симметрично с KanbanBoard, чтобы переброс из notification работал и в list-view.
  const [searchParams, setSearchParams] = useSearchParams();
  const deepLinkedRef = useRef(false);
  useEffect(() => {
    if (deepLinkedRef.current || loading) return;
    const taskId = searchParams.get('task');
    if (!taskId) return;
    deepLinkedRef.current = true;
    const task = tasks.find((t) => t.id === taskId);
    // #comment-<id> из hash — ловим до очистки query (setSearchParams сбрасывает hash).
    const hashMatch = /^#comment-(.+)$/.exec(window.location.hash);
    const scrollToCommentId = hashMatch ? hashMatch[1] : undefined;
    if (task) setDialog({ mode: 'edit', task, scrollToCommentId });
    const next = new URLSearchParams(searchParams);
    next.delete('task');
    setSearchParams(next, { replace: true });
  }, [loading, tasks, searchParams, setSearchParams]);

  // Фильтр hide-done применяем ДО сортировки/группировки. Сами done-задачи
  // остаются в data — это просто скрытие в текущем view'е.
  const visible = hideDone ? tasks.filter((t) => t.status !== 'done') : tasks;

  // Сортируем по статусу (todo → in_progress → done), внутри статуса — по position.
  // Это даёт «открытые наверху, готовые внизу» без явных section-заголовков.
  const sorted = [...visible].sort((a, b) => {
    const s = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (s !== 0) return s;
    return a.position - b.position;
  });

  // Tails для footer-композера в TaskDrawer + чекбокса (afterTaskId при move'е).
  // Считаем по ВСЕМ задачам (не visible), иначе при hideDone чекбокс перемещения
  // в done будет промахиваться мимо реального хвоста.
  const sortByPos = (a: Task, b: Task): number => a.position - b.position;
  const backlogList = tasks.filter((t) => t.status === 'backlog').sort(sortByPos);
  const todoList = tasks.filter((t) => t.status === 'todo').sort(sortByPos);
  const doneList = tasks.filter((t) => t.status === 'done').sort(sortByPos);
  const backlogTail = backlogList[backlogList.length - 1] ?? null;
  const todoTail = todoList[todoList.length - 1] ?? null;
  const lastTodoTaskId = todoTail?.id ?? null;
  const lastDoneTaskId = doneList[doneList.length - 1]?.id ?? null;

  const handleDialogSubmit = async (input: {
    description: string;
    ralphMode?: import('@/domain/task/Task').RalphMode;
    delegateUserId?: string | null;
    deadline?: string | null;
    priority?: import('@/domain/task/Task').TaskPriority | null;
  }): Promise<Task> => {
    if (!dialog) throw new Error('Dialog state missing');
    if (dialog.mode === 'create') return create({ ...input, status: dialog.status });
    // edit-mode: delegateUserId/deadline/priority — отдельные PATCH через chips.
    return update(dialog.task.id, { description: input.description, ralphMode: input.ralphMode });
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
              showCheckbox
              currentUserId={user?.id ?? null}
              lastDoneTaskId={lastDoneTaskId}
              lastTodoTaskId={lastTodoTaskId}
              onEdit={() => setDialog({ mode: 'edit', task: t })}
              onDelete={() => handleDelete(t)}
              onChanged={() => void refetch()}
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
        backlogTail={backlogTail}
        todoTail={todoTail}
        isInbox={!showCommits}
        aiProjectId={showCommits ? projectId : null}
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fmt = useTextFieldFormatting(textareaRef);

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
      <ContextMenu onOpenChange={fmt.onMenuOpenChange}>
        <ContextMenuTrigger asChild>
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              fmt.keyDownHandler(e);
              if (!e.defaultPrevented) handleKeyDown(e);
            }}
            rows={1}
            autoFocus
            disabled={submitting}
            placeholder="Что нужно сделать? Enter — добавить, Shift+Enter — новая строка"
            className="block w-full resize-none rounded-lg bg-transparent px-4 py-3 text-sm leading-snug placeholder:text-muted-foreground/70 focus:outline-none disabled:opacity-50"
          />
        </ContextMenuTrigger>
        {fmt.menuContent}
      </ContextMenu>
      {submitting && (
        <Loader2 className="absolute right-3 top-3.5 size-4 animate-spin text-muted-foreground" />
      )}
    </div>
  );
}

function TaskListRow({
  task,
  showCheckbox,
  currentUserId,
  lastDoneTaskId,
  lastTodoTaskId,
  onEdit,
  onDelete,
  onChanged,
}: {
  task: Task;
  showCheckbox: boolean;
  currentUserId: string | null;
  lastDoneTaskId: string | null;
  lastTodoTaskId: string | null;
  onEdit: () => void;
  onDelete: () => void;
  onChanged: () => void;
}): React.ReactElement {
  const isDone = task.status === 'done';
  const hasDelegation = task.delegation !== null && task.delegation !== undefined;
  const hasBadges =
    (task.attachmentCount ?? 0) > 0 ||
    (task.commentCount ?? 0) > 0 ||
    task.ralphMode !== 'normal' ||
    hasDelegation ||
    task.deadline !== null;

  return (
    <li
      className={cn(
        'group flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40',
        // Priority-accent — левый цветной border 4px. На List-row даёт визуально
        // понятный «прокрашенный» strip слева, не меняя bg и не конкурируя с
        // bg-muted hover.
        task.priority && `border-l-4 ${PRIORITY_META[task.priority].border}`,
      )}
      onClick={onEdit}
    >
      {showCheckbox && (
        <InboxCheckbox
          task={task}
          lastDoneTaskId={lastDoneTaskId}
          lastTodoTaskId={lastTodoTaskId}
          onChanged={onChanged}
        />
      )}
      <div className="min-w-0 flex-1">
        {task.description?.trim() ? (
          <Markdown
            className={cn(
              MARKDOWN_COMPACT,
              'line-clamp-2',
              isDone && 'line-through opacity-60',
            )}
          >
            {task.description}
          </Markdown>
        ) : (
          <p className="text-sm leading-snug text-muted-foreground">—</p>
        )}
        {hasBadges && (
          <div className="mt-1.5 flex items-center gap-2 text-[10px] text-muted-foreground">
            {task.delegation && currentUserId && (
              <DelegationBadge delegation={task.delegation} currentUserId={currentUserId} />
            )}
            {(task.commentCount ?? 0) > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-violet-500/15 px-1.5 py-0.5 text-violet-600 dark:bg-violet-400/15 dark:text-violet-400">
                <MessageSquare className="size-2.5" />
                {task.commentCount}
              </span>
            )}
            {(task.attachmentCount ?? 0) > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-400">
                <ImageIcon className="size-2.5" />
                {task.attachmentCount}
              </span>
            )}
            <RalphModeBadge mode={task.ralphMode} />
            {task.deadline && <DeadlineBadge deadline={task.deadline} status={task.status} />}
            <span
              className="opacity-60"
              title={task.createdAt.toLocaleString('ru-RU')}
            >
              {relativeTime(task.createdAt)}
            </span>
          </div>
        )}
      </div>
      <div className="flex shrink-0 gap-0.5">
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
