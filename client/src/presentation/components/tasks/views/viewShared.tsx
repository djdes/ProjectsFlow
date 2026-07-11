import { useState, type KeyboardEvent } from 'react';
import {
  CalendarDays,
  CircleDot,
  Copy,
  Flag,
  Link as LinkIcon,
  Maximize2,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Task, TaskPriority, TaskStatus } from '@/domain/task/Task';
import { TASK_PRIORITIES } from '@/domain/task/Task';
import { PRIORITY_META } from '@/domain/task/priorityMeta';
import { VISIBLE_KANBAN_STATUSES } from '@/domain/kanban/KanbanSettings';
import type { UseTasks } from '@/presentation/hooks/useTasks';
import { STATUS_LABEL } from '../statusLabels';
import { TaskDrawer, type TaskDrawerState } from '../TaskDrawer';
import { splitTitleBody } from '@/lib/taskTitleBody';
import { ymd, startOfDay, addDays } from '../assignedGrouping';
import type { MenuEntry } from './menuEntries';

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

// Цветные пилюли значений select-свойств (Notion: статус в таблице — pill с фоном).
export const STATUS_PILL: Record<TaskStatus, string> = {
  backlog: 'bg-muted text-foreground/70',
  manual: 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300',
  todo: 'bg-blue-100 text-blue-900 dark:bg-blue-500/15 dark:text-blue-300',
  in_progress: 'bg-blue-100 text-blue-900 dark:bg-blue-500/15 dark:text-blue-300',
  awaiting_clarification: 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300',
  done: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-300',
};

export const PRIORITY_PILL: Record<TaskPriority, string> = {
  1: 'bg-red-100 text-red-900 dark:bg-red-500/15 dark:text-red-300',
  2: 'bg-orange-100 text-orange-900 dark:bg-orange-500/15 dark:text-orange-300',
  3: 'bg-blue-100 text-blue-900 dark:bg-blue-500/15 dark:text-blue-300',
  4: 'bg-muted text-foreground/70',
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

// ---- Фильтры и сортировка вью (тулбар в ProjectBoardViews, применение — в видах) ----

export type ViewDueFilter = 'has' | 'none' | 'overdue';

// Значения фильтров — мультивыбор чекбоксами, как в Notion (пустой массив = не фильтруем).
export type ViewFilters = {
  readonly query: string;
  readonly statuses: readonly TaskStatus[];
  readonly priorities: readonly TaskPriority[];
  readonly due: ViewDueFilter | null;
};

export const EMPTY_VIEW_FILTERS: ViewFilters = {
  query: '',
  statuses: [],
  priorities: [],
  due: null,
};

export function hasActiveFilters(f: ViewFilters): boolean {
  return f.statuses.length > 0 || f.priorities.length > 0 || f.due !== null;
}

export function matchesFilters(task: Task, f: ViewFilters): boolean {
  if (!matchesQuery(task, f.query)) return false;
  if (f.statuses.length > 0 && !f.statuses.includes(task.status)) return false;
  if (f.priorities.length > 0) {
    if (task.priority === null || task.priority === undefined) return false;
    if (!f.priorities.includes(task.priority)) return false;
  }
  if (f.due !== null) {
    const today = ymd(startOfDay(new Date()));
    if (f.due === 'has' && !task.deadline) return false;
    if (f.due === 'none' && task.deadline) return false;
    if (f.due === 'overdue' && !(task.deadline && task.deadline < today && task.status !== 'done'))
      return false;
  }
  return true;
}

// Скрываемые колонки-свойства табличного вида («Название» не скрывается, как в Notion).
export type ViewColumn = 'status' | 'priority' | 'deadline' | 'assignee';

export const VIEW_COLUMN_LABELS: Record<ViewColumn, string> = {
  status: 'Статус',
  priority: 'Приоритет',
  deadline: 'Срок',
  assignee: 'Ответственный',
};

// Контекстное меню задачи (строка таблицы/списка, чип календаря) — копия Notion-меню
// страницы: Открыть / Изменить свойство ▸ / Скопировать ссылку / Дублировать /
// Удалить + футер «Изменено …».
export function taskMenuEntries(
  task: Task,
  projectId: string,
  h: {
    onOpen: () => void;
    onStatus: (s: TaskStatus) => void;
    onPriority: (p: TaskPriority | null) => void;
    onDeadline: (d: string | null) => void;
    onDuplicate: () => void;
    onDelete: () => void;
  },
): MenuEntry[] {
  const today = ymd(startOfDay(new Date()));
  const statusSub: MenuEntry = {
    kind: 'sub',
    label: 'Статус',
    icon: CircleDot,
    items: VISIBLE_KANBAN_STATUSES.map((s) => ({
      kind: 'item' as const,
      label: STATUS_LABEL[s],
      dotClass: STATUS_DOT[s],
      checked: task.status === s,
      onSelect: () => h.onStatus(s),
    })),
  };
  const prioritySub: MenuEntry = {
    kind: 'sub',
    label: 'Приоритет',
    icon: Flag,
    items: [
      ...TASK_PRIORITIES.map((p) => ({
        kind: 'item' as const,
        label: PRIORITY_META[p].label,
        dotClass: PRIORITY_META[p].dotColor,
        checked: task.priority === p,
        onSelect: () => h.onPriority(p),
      })),
      { kind: 'separator' as const },
      { kind: 'item' as const, label: 'Без приоритета', muted: true, onSelect: () => h.onPriority(null) },
    ],
  };
  const deadlineSub: MenuEntry = {
    kind: 'sub',
    label: 'Срок',
    icon: CalendarDays,
    items: [
      { kind: 'item', label: 'Сегодня', onSelect: () => h.onDeadline(today) },
      {
        kind: 'item',
        label: 'Завтра',
        onSelect: () => h.onDeadline(ymd(addDays(startOfDay(new Date()), 1))),
      },
      ...(task.deadline
        ? ([
            { kind: 'separator' },
            { kind: 'item', label: 'Убрать срок', muted: true, onSelect: () => h.onDeadline(null) },
          ] as MenuEntry[])
        : []),
    ],
  };
  const copyLink = (): void => {
    const url = `${window.location.origin}/projects/${projectId}/tasks/${task.id}`;
    void navigator.clipboard.writeText(url).catch(() => undefined);
  };
  const edited = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(
    task.updatedAt,
  );
  return [
    { kind: 'item', label: 'Открыть', icon: Maximize2, onSelect: h.onOpen },
    { kind: 'separator' },
    {
      kind: 'sub',
      label: 'Изменить свойство',
      icon: Pencil,
      items: [statusSub, prioritySub, deadlineSub],
    },
    { kind: 'separator' },
    { kind: 'item', label: 'Скопировать ссылку', icon: LinkIcon, onSelect: copyLink },
    { kind: 'item', label: 'Дублировать', icon: Copy, onSelect: h.onDuplicate },
    { kind: 'item', label: 'Удалить', icon: Trash2, destructive: true, onSelect: h.onDelete },
    { kind: 'separator' },
    { kind: 'label', label: `Изменено ${edited}` },
  ];
}

export type ViewSortKey = 'title' | 'status' | 'priority' | 'deadline' | 'created';
export type ViewSort = { readonly key: ViewSortKey; readonly dir: 'asc' | 'desc' };

export const VIEW_SORT_LABELS: Record<ViewSortKey, string> = {
  title: 'Название',
  status: 'Статус',
  priority: 'Приоритет',
  deadline: 'Срок',
  created: 'Дата создания',
};

// null-значения (без срока/приоритета) — всегда в конец независимо от направления.
export function applyViewSort(tasks: readonly Task[], sort: ViewSort | null): Task[] {
  if (!sort) return sortBoardTasks(tasks);
  const mul = sort.dir === 'asc' ? 1 : -1;
  const cmp = (a: Task, b: Task): number => {
    switch (sort.key) {
      case 'title':
        return taskTitle(a).localeCompare(taskTitle(b), 'ru') * mul;
      case 'status':
        return (STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)) * mul;
      case 'priority': {
        const pa = a.priority ?? 99;
        const pb = b.priority ?? 99;
        if (pa === 99 || pb === 99) return pa - pb;
        return (pa - pb) * mul;
      }
      case 'deadline': {
        const da = a.deadline ?? '';
        const db = b.deadline ?? '';
        if (!da || !db) return (da ? 0 : 1) - (db ? 0 : 1);
        return da.localeCompare(db) * mul;
      }
      case 'created':
        return (a.createdAt.getTime() - b.createdAt.getTime()) * mul;
    }
  };
  return [...tasks].sort((a, b) => cmp(a, b) || a.position - b.position);
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
