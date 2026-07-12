import { useState, type KeyboardEvent } from 'react';
import {
  Bookmark,
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

// Заголовок — plain text (Notion): markdown-разметка первой строки описания
// (**жирный**, `код`, # заголовок, [текст](url)) в названии не показывается.
function stripMdInline(s: string): string {
  return s
    .replace(/^#{1,6}\s+/, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/`([^`]*)`/g, '$1');
}

export function taskTitle(task: Task): string {
  const raw = splitTitleBody(task.description ?? '').title;
  return stripMdInline(raw).trim() || 'Без названия';
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
    onStartDate: (d: string | null) => void;
    onDuplicate: () => void;
    onDelete: () => void;
    // Подзадачи (db/107): inline-создание под родителем. undefined = пункт скрыт.
    onAddSub?: () => void;
    // Шаблоны (db/108): сохранить задачу как шаблон проекта. undefined = пункт скрыт.
    onSaveTemplate?: () => void;
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
  // Дата начала (db/106): диапазон startDate → deadline рисуется полосой в календаре.
  const startDateSub: MenuEntry = {
    kind: 'sub',
    label: 'Дата начала',
    icon: CalendarDays,
    items: [
      { kind: 'item', label: 'Сегодня', onSelect: () => h.onStartDate(today) },
      {
        kind: 'item',
        label: 'Завтра',
        onSelect: () => h.onStartDate(ymd(addDays(startOfDay(new Date()), 1))),
      },
      ...(task.startDate
        ? ([
            { kind: 'separator' },
            {
              kind: 'item',
              label: 'Убрать дату начала',
              muted: true,
              onSelect: () => h.onStartDate(null),
            },
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
    // «Добавить подзадачу» здесь НЕ показываем — в Notion в контекст-меню строки
    // такого пункта нет (по фидбеку юзера); дерево подзадач при этом живо.
    { kind: 'item', label: 'Открыть', icon: Maximize2, onSelect: h.onOpen },
    { kind: 'separator' },
    {
      kind: 'sub',
      label: 'Изменить свойство',
      icon: Pencil,
      items: [statusSub, prioritySub, deadlineSub, startDateSub],
    },
    { kind: 'separator' },
    { kind: 'item', label: 'Скопировать ссылку', icon: LinkIcon, onSelect: copyLink },
    { kind: 'item', label: 'Дублировать', icon: Copy, onSelect: h.onDuplicate },
    ...(h.onSaveTemplate
      ? ([
          {
            kind: 'item',
            label: 'Сохранить как шаблон',
            icon: Bookmark,
            onSelect: h.onSaveTemplate,
          },
        ] as MenuEntry[])
      : []),
    { kind: 'item', label: 'Удалить', icon: Trash2, destructive: true, onSelect: h.onDelete },
    { kind: 'separator' },
    { kind: 'label', label: `Изменено ${edited}` },
  ];
}

// ---- Состояние табличного вида (Notion table): ширины колонок, перенос текста,
// подсчёты под колонками ----

export type ViewCalc = 'count' | 'notEmpty' | 'empty' | 'pctNotEmpty';

export const VIEW_CALC_LABELS: Record<ViewCalc, string> = {
  count: 'Всего',
  notEmpty: 'Заполнено',
  empty: 'Пусто',
  pctNotEmpty: '% заполнено',
};

export type TableViewState = {
  // Ключ: 'title' | ViewColumn | `p:<propertyId>` (кастомные свойства db/109).
  readonly colWidths: Partial<Record<string, number>>;
  readonly wrapTitle: boolean;
  readonly freezeTitle: boolean;
  readonly calc: Partial<Record<ViewColumn, ViewCalc>>;
};

export const EMPTY_TABLE_STATE: TableViewState = {
  colWidths: {},
  wrapTitle: false,
  // Notion: колонка названия закреплена по умолчанию — текст не режется при
  // горизонтальном скролле. Выключается в меню «Название» → «Закрепить колонку».
  freezeTitle: true,
  calc: {},
};

// ---- Группировка, условные цвета, режим календаря (Notion) ----

export type ViewGrouping = 'status' | 'priority' | 'assignee';

export const VIEW_GROUPING_LABELS: Record<ViewGrouping, string> = {
  status: 'Статус',
  priority: 'Приоритет',
  assignee: 'Ответственный',
};

// Условный цвет строки (Notion Conditional color): «если свойство = значение → цвет».
export type ViewColorRule = {
  readonly prop: 'status' | 'priority';
  readonly value: string; // TaskStatus или String(TaskPriority)
  readonly color: ViewRuleColor;
};

export type ViewRuleColor = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink' | 'gray';

export const RULE_COLOR_LABELS: Record<ViewRuleColor, string> = {
  red: 'Красный',
  orange: 'Оранжевый',
  yellow: 'Жёлтый',
  green: 'Зелёный',
  blue: 'Синий',
  purple: 'Фиолетовый',
  pink: 'Розовый',
  gray: 'Серый',
};

// Фон строки по правилу (светлая/тёмная тема).
export const RULE_COLOR_ROW: Record<ViewRuleColor, string> = {
  red: 'bg-red-50 dark:bg-red-500/10',
  orange: 'bg-orange-50 dark:bg-orange-500/10',
  yellow: 'bg-yellow-50 dark:bg-yellow-500/10',
  green: 'bg-emerald-50 dark:bg-emerald-500/10',
  blue: 'bg-blue-50 dark:bg-blue-500/10',
  purple: 'bg-purple-50 dark:bg-purple-500/10',
  pink: 'bg-pink-50 dark:bg-pink-500/10',
  gray: 'bg-muted/60',
};

// Точка-превью цвета в меню.
export const RULE_COLOR_DOT: Record<ViewRuleColor, string> = {
  red: 'bg-red-400',
  orange: 'bg-orange-400',
  yellow: 'bg-yellow-400',
  green: 'bg-emerald-400',
  blue: 'bg-blue-400',
  purple: 'bg-purple-400',
  pink: 'bg-pink-400',
  gray: 'bg-muted-foreground/50',
};

export function rowColorFor(task: Task, rules: readonly ViewColorRule[]): string | null {
  for (const r of rules) {
    if (r.prop === 'status' && task.status === r.value) return RULE_COLOR_ROW[r.color];
    if (r.prop === 'priority' && String(task.priority ?? '') === r.value)
      return RULE_COLOR_ROW[r.color];
  }
  return null;
}

// ---- Подзадачи (Notion sub-items): дерево строк для таблицы/списка ----

export type TreeRow = { task: Task; depth: number; hasChildren: boolean };

// rows приходят уже отсортированными; дети рендерятся под родителем с отступом.
// Родитель вне списка (отфильтрован/другой стейт) — ребёнок показывается корневым.
export function buildTreeRows(rows: readonly Task[], expanded: ReadonlySet<string>): TreeRow[] {
  const ids = new Set(rows.map((t) => t.id));
  const byParent = new Map<string | null, Task[]>();
  for (const t of rows) {
    const parent = t.parentTaskId && ids.has(t.parentTaskId) ? t.parentTaskId : null;
    const arr = byParent.get(parent);
    if (arr) arr.push(t);
    else byParent.set(parent, [t]);
  }
  const out: TreeRow[] = [];
  const walk = (parent: string | null, depth: number): void => {
    if (depth > 6) return; // safety-cap вложенности
    for (const t of byParent.get(parent) ?? []) {
      const hasChildren = byParent.has(t.id);
      out.push({ task: t, depth, hasChildren });
      if (hasChildren && expanded.has(t.id)) walk(t.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

// Ключ группы задачи при активной группировке.
export function groupKeyFor(task: Task, grouping: ViewGrouping): string {
  switch (grouping) {
    case 'status':
      return task.status;
    case 'priority':
      return String(task.priority ?? 'none');
    case 'assignee':
      return task.delegation?.delegateUserId ?? 'none';
  }
}

export function groupLabelFor(key: string, grouping: ViewGrouping, sample?: Task): string {
  switch (grouping) {
    case 'status':
      return STATUS_LABEL[key as TaskStatus] ?? key;
    case 'priority':
      return key === 'none' ? 'Без приоритета' : PRIORITY_META[Number(key) as TaskPriority].label;
    case 'assignee':
      return key === 'none'
        ? 'Без ответственного'
        : (sample?.delegation?.delegateDisplayName ?? 'Участник');
  }
}

// ---- Пер-вью конфиг (board_views.config, db/105): весь стейт вью на сервере ----

export type ViewConfig = {
  filters?: ViewFilters;
  sort?: ViewSort | null;
  hidden?: ViewColumn[];
  // table сериализуется с unfreezeTitle (инверсия freezeTitle — см. perViewToConfig);
  // freezeTitle оставлен для чтения совсем старых конфигов.
  table?: {
    colWidths?: Partial<Record<string, number>>;
    wrapTitle?: boolean;
    unfreezeTitle?: boolean;
    freezeTitle?: boolean;
    calc?: Partial<Record<ViewColumn, ViewCalc>>;
  };
  grouping?: ViewGrouping | null;
  colorRules?: ViewColorRule[];
  calendarMode?: 'month' | 'week';
  // Кастомная эмодзи-иконка вью (Notion view icon); null — иконка типа.
  icon?: string | null;
};

export type PerViewState = {
  filters: ViewFilters;
  sort: ViewSort | null;
  hidden: ViewColumn[];
  table: TableViewState;
  grouping: ViewGrouping | null;
  colorRules: ViewColorRule[];
  calendarMode: 'month' | 'week';
  icon: string | null;
};

export const EMPTY_PER_VIEW_STATE: PerViewState = {
  filters: EMPTY_VIEW_FILTERS,
  sort: null,
  hidden: [],
  table: EMPTY_TABLE_STATE,
  grouping: null,
  colorRules: [],
  calendarMode: 'month',
  icon: null,
};

export function perViewToConfig(s: PerViewState): ViewConfig {
  return {
    filters: s.filters,
    sort: s.sort,
    hidden: s.hidden,
    // freeze сериализуем ИНВЕРСИЕЙ (unfreezeTitle): так старые конфиги без ключа
    // получают Notion-дефолт «закреплено», а явное выключение переживает reload.
    table: {
      colWidths: s.table.colWidths,
      wrapTitle: s.table.wrapTitle,
      unfreezeTitle: !s.table.freezeTitle,
      calc: s.table.calc,
    },
    grouping: s.grouping,
    colorRules: s.colorRules,
    calendarMode: s.calendarMode,
    icon: s.icon,
  };
}

// Прозрачный JSON с сервера → состояние с дефолтами (мягкая валидация форм).
export function perViewFromConfig(c: unknown): PerViewState {
  const cfg = (c ?? {}) as ViewConfig;
  return {
    filters: {
      query: '',
      statuses: Array.isArray(cfg.filters?.statuses) ? cfg.filters.statuses : [],
      priorities: Array.isArray(cfg.filters?.priorities) ? cfg.filters.priorities : [],
      due: cfg.filters?.due ?? null,
    },
    sort: cfg.sort && typeof cfg.sort === 'object' ? cfg.sort : null,
    hidden: Array.isArray(cfg.hidden) ? cfg.hidden : [],
    table: {
      colWidths: cfg.table?.colWidths && typeof cfg.table.colWidths === 'object' ? cfg.table.colWidths : {},
      wrapTitle: Boolean(cfg.table?.wrapTitle),
      // Notion-дефолт: закреплено, если явно не выключено (unfreezeTitle: true).
      freezeTitle: !(cfg.table?.unfreezeTitle ?? false),
      calc: cfg.table?.calc && typeof cfg.table.calc === 'object' ? cfg.table.calc : {},
    },
    grouping: cfg.grouping ?? null,
    colorRules: Array.isArray(cfg.colorRules) ? cfg.colorRules : [],
    calendarMode: cfg.calendarMode === 'week' ? 'week' : 'month',
    icon: typeof cfg.icon === 'string' && cfg.icon ? cfg.icon : null,
  };
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
  closeOnSubmit = false,
}: {
  create: UseTasks['create'];
  status?: TaskStatus;
  deadline?: string | null;
  className?: string;
  // Notion-таблица: Enter создаёт, закрывает ввод (созданную строку выделяет
  // родитель через обёрнутый create). По умолчанию — цепочка ввода как раньше.
  closeOnSubmit?: boolean;
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
      if (closeOnSubmit) setOpen(false);
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
