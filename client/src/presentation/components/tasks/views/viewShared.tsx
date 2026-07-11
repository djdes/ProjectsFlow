import { useState, type KeyboardEvent } from 'react';
import { Plus, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Task, TaskStatus } from '@/domain/task/Task';
import type { UseTasks } from '@/presentation/hooks/useTasks';
import { TaskDrawer, type TaskDrawerState } from '../TaskDrawer';
import { splitTitleBody } from '@/lib/taskTitleBody';

// ============ Общие кусочки табличного/списочного/календарного видов доски ============
// (план board-views-design). Канбан не трогаем — он остаётся в KanbanBoard.

// Цветовая точка статуса (статичные цвета — пер-проектные переименования/цвета канбана
// сюда не тянем, v1). Ключи включают невидимые статусы (живут в TODO на канбане).
export const STATUS_DOT: Record<TaskStatus, string> = {
  backlog: 'bg-muted-foreground/50',
  manual: 'bg-amber-400',
  todo: 'bg-blue-500',
  in_progress: 'bg-blue-500',
  awaiting_clarification: 'bg-amber-500',
  done: 'bg-emerald-500',
};

// Порядок строк в таблице/списке: по колонкам доски, внутри — по position.
const STATUS_ORDER: readonly TaskStatus[] = [
  'backlog',
  'manual',
  'todo',
  'in_progress',
  'awaiting_clarification',
  'done',
];

export function sortBoardTasks(tasks: readonly Task[]): Task[] {
  return [...tasks].sort(
    (a, b) =>
      STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.position - b.position,
  );
}

export function taskTitle(task: Task): string {
  return splitTitleBody(task.description ?? '').title || 'Без названия';
}

export function matchesQuery(task: Task, query: string): boolean {
  const q = query.trim().toLocaleLowerCase('ru');
  if (!q) return true;
  return (task.description ?? '').toLocaleLowerCase('ru').includes(q);
}

// Тихий текстовый фильтр — тот же вид, что у ряда фильтров канбана.
export function ViewSearchInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}): React.ReactElement {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Фильтр по тексту…"
        aria-label="Фильтр задач по тексту"
        className="h-7 w-32 rounded-md bg-transparent pl-7 pr-2 text-xs outline-none transition-colors placeholder:text-muted-foreground/60 hover:bg-accent/60 focus:bg-accent/60 sm:w-44"
      />
    </div>
  );
}

// «+ Новая задача» (Notion-style): кнопка → inline-поле, Enter создаёт и оставляет поле
// для следующей, Esc/blur закрывает. deadline — для календаря (создание в конкретный день).
export function NewTaskRow({
  create,
  status = 'backlog',
  deadline = null,
  className,
}: {
  create: UseTasks['create'];
  status?: TaskStatus;
  deadline?: string | null;
  className?: string;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    const name = value.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      await create({ description: name, status, deadline: deadline ?? undefined });
      setValue('');
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      setValue('');
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
          className,
        )}
      >
        <Plus className="size-4" />
        Новая задача
      </button>
    );
  }
  return (
    <input
      autoFocus
      value={value}
      disabled={busy}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => {
        void submit().then(() => setOpen(false));
      }}
      placeholder="Название задачи…"
      className={cn(
        'w-full rounded-md border bg-card px-2 py-1.5 text-sm outline-none ring-1 ring-primary/20 placeholder:text-muted-foreground/60',
        className,
      )}
    />
  );
}

// Окно задачи для табличного/списочного/календарного видов — минимальная обвязка над
// TaskDrawer (тот же паттерн, что у KanbanBoard, без prev/next-навигации).
export function ViewTaskDrawer({
  state,
  onClose,
  projectId,
  projectName,
  isShared,
  tasksApi,
}: {
  state: TaskDrawerState | null;
  onClose: () => void;
  projectId: string;
  projectName?: string;
  isShared: boolean;
  tasksApi: UseTasks;
}): React.ReactElement {
  return (
    <TaskDrawer
      state={state}
      onClose={onClose}
      onSubmit={async (input) => {
        if (!state) throw new Error('Dialog state missing');
        if (state.mode === 'create') {
          return tasksApi.create({ ...input, status: state.status });
        }
        return tasksApi.update(state.task.id, {
          description: input.description,
          ralphMode: input.ralphMode,
        });
      }}
      onCommitsChange={() => void tasksApi.refetch()}
      projectName={projectName}
      isInbox={false}
      isShared={isShared}
      aiProjectId={projectId}
      onMove={async (taskId, targetStatus) => {
        await tasksApi.move(taskId, { targetStatus, beforeTaskId: null, afterTaskId: null });
      }}
    />
  );
}
