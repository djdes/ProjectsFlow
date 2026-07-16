import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  Eye,
  FileText,
  List,
  MapPin,
  MessageCircle,
  Plus,
  Share2,
  Table2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import type { BoardViewType } from '@/domain/project/BoardView';
import type { Task, TaskStatus } from '@/domain/task/Task';
import { ProjectIconView } from '@/presentation/components/project/projectIconView';
import { useTasks } from '@/presentation/hooks/useTasks';
import { type TaskDrawerState } from '../TaskDrawer';
import { DeadlineBadge } from '../DeadlineBadge';
import { STATUS_LABEL } from '../statusLabels';
import type { ViewCreateRequest } from './ProjectBoardViews';
import {
  STATUS_DOT,
  ViewTaskDrawer,
  applyViewSort,
  matchesFilters,
  taskTitle,
  type ViewFilters,
  type ViewFormState,
  type ViewLayoutState,
  type ViewSort,
} from './viewShared';
import { ViewLoadFeedback } from './ViewLoadFeedback';

export type ExtendedViewType = Extract<
  BoardViewType,
  'timeline' | 'gallery' | 'chart' | 'feed' | 'map' | 'dashboard' | 'form'
>;

type Props = {
  type: ExtendedViewType;
  projectId: string;
  projectName?: string;
  memberCount?: number;
  filters: ViewFilters;
  sort: ViewSort | null;
  layout: ViewLayoutState;
  onLayoutChange: (patch: Partial<ViewLayoutState>) => void;
  form: ViewFormState;
  onFormChange: (patch: Partial<ViewFormState>) => void;
  createRequest: ViewCreateRequest | null;
  canEdit?: boolean;
};

const STATUS_ORDER: readonly TaskStatus[] = [
  'backlog',
  'todo',
  'in_progress',
  'awaiting_clarification',
  'manual',
  'done',
];

function parseYmd(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year!, (month ?? 1) - 1, day ?? 1);
}

function dayDiff(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function addDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function ymd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

function TaskIcon({
  task,
  visible,
}: {
  task: Task;
  visible: boolean;
}): React.ReactElement | null {
  if (!visible) return null;
  if (task.icon) {
    return (
      <span className="grid size-4 shrink-0 place-items-center overflow-hidden">
        <ProjectIconView icon={task.icon} pixelSize={15} className="text-sm" />
      </span>
    );
  }
  return <FileText className="size-4 shrink-0 text-muted-foreground/60" />;
}

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}): React.ReactElement {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center gap-2 px-6 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-md text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

export function ExtendedProjectView({
  type,
  projectId,
  projectName,
  memberCount,
  filters,
  sort,
  layout,
  onLayoutChange,
  form,
  onFormChange,
  createRequest,
  canEdit = true,
}: Props): React.ReactElement {
  const tasksApi = useTasks(projectId);
  const { tasks, loading, error, create, refetch } = tasksApi;
  const rows = useMemo(
    () => applyViewSort(tasks.filter((task) => matchesFilters(task, filters)), sort),
    [filters, sort, tasks],
  );
  const [drawer, setDrawer] = useState<TaskDrawerState | null>(null);
  const isShared = (memberCount ?? 0) > 1;

  useEffect(() => {
    if (!createRequest || !canEdit) return;
    const template = createRequest.template;
    if (template) {
      void create({
        description: template.description || template.name,
        status: template.status,
        priority: template.priority,
        icon: template.icon,
      }).catch((cause: unknown) => toast.error(`Не удалось: ${(cause as Error).message}`));
      return;
    }
    setDrawer({ mode: 'create', status: createRequest.status });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createRequest, canEdit]);

  const openTask = (task: Task): void => setDrawer({ mode: 'edit', task });

  let content: React.ReactElement;
  if (loading && rows.length === 0) {
    content = (
      <div className="grid min-h-64 place-items-center text-sm text-muted-foreground">
        Загрузка отображения…
      </div>
    );
  } else if (type === 'timeline') {
    content = <TimelineView rows={rows} layout={layout} onOpen={openTask} />;
  } else if (type === 'gallery') {
    content = <GalleryView rows={rows} layout={layout} onOpen={openTask} />;
  } else if (type === 'chart') {
    content = <ChartView rows={rows} />;
  } else if (type === 'feed') {
    content = <FeedView rows={rows.slice(0, layout.feedLimit)} layout={layout} onOpen={openTask} />;
  } else if (type === 'map') {
    content = <MapView rows={rows} />;
  } else if (type === 'dashboard') {
    content = (
      <DashboardView
        rows={rows}
        canEdit={canEdit}
        modules={layout.dashboardModules}
        onModulesChange={(dashboardModules) => onLayoutChange({ dashboardModules })}
        onOpen={openTask}
      />
    );
  } else {
    content = (
      <FormView
        form={form}
        onChange={onFormChange}
        canEdit={canEdit}
        onSubmit={async (title) => {
          await create({ description: title, status: 'backlog' });
        }}
      />
    );
  }

  return (
    <div className="min-w-0">
      <ViewLoadFeedback
        error={error}
        hasData={rows.length > 0}
        onRetry={refetch}
        label="задачи"
      />
      {content}
      <ViewTaskDrawer
        state={drawer}
        onClose={() => setDrawer(null)}
        projectId={projectId}
        projectName={projectName}
        isShared={isShared}
        tasksApi={tasksApi}
        canEdit={canEdit}
      />
    </div>
  );
}

function TimelineView({
  rows,
  layout,
  onOpen,
}: {
  rows: Task[];
  layout: ViewLayoutState;
  onOpen: (task: Task) => void;
}): React.ReactElement {
  const today = new Date();
  const start = addDays(new Date(today.getFullYear(), today.getMonth(), 1), -7);
  const days = Array.from({ length: 56 }, (_, index) => addDays(start, index));
  const dated = rows.filter((task) => task.deadline);
  const noDate = rows.filter((task) => !task.deadline);
  const dayWidth = 48;
  const timelineWidth = days.length * dayWidth;
  const todayOffset = dayDiff(start, new Date(today.getFullYear(), today.getMonth(), today.getDate()));
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const scroller = scrollerRef.current;
      if (!scroller || todayOffset < 0 || todayOffset >= days.length) return;
      scroller.scrollLeft = Math.max(
        0,
        220 + todayOffset * dayWidth - Math.round(scroller.clientWidth * 0.55),
      );
    });
    return () => window.cancelAnimationFrame(frame);
  }, [days.length, todayOffset]);

  return (
    <div
      ref={scrollerRef}
      className="overflow-x-auto overscroll-x-contain [scrollbar-gutter:stable]"
    >
      <div className="min-w-[920px]" style={{ width: 220 + timelineWidth }}>
        <div className="mb-2 flex h-8 items-center justify-between text-xs text-muted-foreground">
          <span>Без даты ({noDate.length})</span>
          <span className="capitalize">
            {new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(today)}
          </span>
        </div>
        <div className="grid grid-cols-[220px_1fr] border-y">
          <div className="border-r px-2 py-2 text-xs font-medium text-muted-foreground">
            Задача
          </div>
          <div className="relative overflow-hidden">
            <div className="flex" style={{ width: timelineWidth }}>
              {days.map((day) => (
                <div
                  key={ymd(day)}
                  className={cn(
                    'flex h-9 shrink-0 items-center justify-center border-r text-[10px] text-muted-foreground',
                    day.getDay() === 0 || day.getDay() === 6 ? 'bg-muted/30' : '',
                  )}
                  style={{ width: dayWidth }}
                >
                  {day.getDate()}
                </div>
              ))}
            </div>
          </div>
          {dated.map((task) => {
            const from = task.startDate ? parseYmd(task.startDate) : parseYmd(task.deadline!);
            const to = parseYmd(task.deadline!);
            const left = Math.max(0, dayDiff(start, from)) * dayWidth;
            const width = Math.max(1, dayDiff(from, to) + 1) * dayWidth;
            return (
              <div key={task.id} className="contents">
                <button
                  type="button"
                  onClick={() => onOpen(task)}
                  className="flex h-9 min-w-0 items-center gap-2 border-b border-r px-2 text-left text-xs hover:bg-accent/50"
                >
                  <TaskIcon task={task} visible={layout.showPageIcon} />
                  <span className="truncate">{taskTitle(task)}</span>
                </button>
                <div className="relative h-9 overflow-hidden border-b">
                  <div className="absolute inset-0 flex" style={{ width: timelineWidth }}>
                    {days.map((day) => (
                      <span
                        key={ymd(day)}
                        className={cn(
                          'h-full shrink-0 border-r',
                          day.getDay() === 0 || day.getDay() === 6 ? 'bg-muted/20' : '',
                        )}
                        style={{ width: dayWidth }}
                      />
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => onOpen(task)}
                    className="absolute top-1 h-7 truncate rounded-md border bg-background px-2 text-left text-xs hover:bg-accent"
                    style={{ left, width: Math.max(dayWidth, width) }}
                  >
                    {taskTitle(task)}
                  </button>
                  {todayOffset >= 0 && todayOffset < days.length && (
                    <span
                      className="pointer-events-none absolute inset-y-0 w-px bg-red-500"
                      style={{ left: todayOffset * dayWidth + dayWidth / 2 }}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {dated.length === 0 && (
          <EmptyState
            title="Нет задач с датами"
            description="Добавьте срок или диапазон дат, чтобы задача появилась на таймлайне."
          />
        )}
        {layout.showTimelineTable && noDate.length > 0 && (
          <div className="mt-4 border-t pt-2">
            {noDate.map((task) => (
              <button
                key={task.id}
                type="button"
                onClick={() => onOpen(task)}
                className="flex h-9 w-full items-center gap-2 border-b px-2 text-left text-sm hover:bg-accent/50"
              >
                <TaskIcon task={task} visible={layout.showPageIcon} />
                <span className="truncate">{taskTitle(task)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function GalleryView({
  rows,
  layout,
  onOpen,
}: {
  rows: Task[];
  layout: ViewLayoutState;
  onOpen: (task: Task) => void;
}): React.ReactElement {
  if (rows.length === 0) {
    return <EmptyState title="Галерея пуста" description="Создайте задачу, чтобы появилась карточка." />;
  }
  const width =
    layout.cardSize === 'small'
      ? 'minmax(180px,1fr)'
      : layout.cardSize === 'large'
        ? 'minmax(320px,1fr)'
        : 'minmax(240px,1fr)';
  if (layout.cardLayout === 'list') {
    return (
      <div className="max-w-3xl">
        {rows.map((task) => (
          <button
            key={task.id}
            type="button"
            onClick={() => onOpen(task)}
            className="flex h-9 w-full items-center gap-2 border-b px-2 text-left text-sm hover:bg-accent/50"
          >
            <TaskIcon task={task} visible={layout.showPageIcon} />
            <span className="truncate">{taskTitle(task)}</span>
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fill, ${width})` }}>
      {rows.map((task) => (
        <button
          key={task.id}
          type="button"
          onClick={() => onOpen(task)}
          className="overflow-hidden rounded-lg border bg-background text-left transition-colors hover:bg-accent/30"
        >
          {layout.cardPreview !== 'none' && (
            <div
              className="h-28 border-b bg-muted/40 bg-cover bg-center"
              style={
                task.cover && layout.cardPreview === 'cover'
                  ? { backgroundImage: task.cover }
                  : undefined
              }
            >
              {layout.cardPreview === 'content' && (
                <p className="line-clamp-4 p-3 text-xs text-muted-foreground">
                  {task.description || 'Нет содержимого'}
                </p>
              )}
            </div>
          )}
          <div className="flex items-start gap-2 p-3">
            <TaskIcon task={task} visible={layout.showPageIcon} />
            <div className="min-w-0">
              <p className={cn('text-sm font-medium', layout.wrapAll ? '' : 'truncate')}>
                {taskTitle(task)}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <span className={cn('size-2 rounded-full', STATUS_DOT[task.status])} />
                  {STATUS_LABEL[task.status]}
                </span>
                {task.deadline && <DeadlineBadge deadline={task.deadline} status={task.status} />}
              </div>
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

function ChartView({ rows }: { rows: Task[] }): React.ReactElement {
  const values = STATUS_ORDER.map((status) => ({
    status,
    count: rows.filter((task) => task.status === status).length,
  }));
  const max = Math.max(1, ...values.map((item) => item.count));
  return (
    <div className="min-h-[420px] px-4 pb-6 pt-4">
      <div className="flex h-[340px] items-end gap-5 border-b border-l px-6">
        {values.map(({ status, count }) => (
          <div key={status} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-2">
            <span className="text-xs text-muted-foreground">{count}</span>
            <div
              className={cn('w-full max-w-16 rounded-t-sm', STATUS_DOT[status])}
              style={{ height: `${Math.max(count === 0 ? 2 : 8, (count / max) * 260)}px` }}
              title={`${STATUS_LABEL[status]}: ${count}`}
            />
            <span className="h-10 max-w-full truncate text-[11px] text-muted-foreground">
              {STATUS_LABEL[status]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FeedView({
  rows,
  layout,
  onOpen,
}: {
  rows: Task[];
  layout: ViewLayoutState;
  onOpen: (task: Task) => void;
}): React.ReactElement {
  if (rows.length === 0) {
    return <EmptyState title="Лента пуста" description="Новые задачи появятся здесь публикациями." />;
  }
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3">
      {rows.map((task) => (
        <article key={task.id} className="rounded-xl border bg-background px-5 py-4">
          {layout.showAuthorByline && (
            <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
              <span className="grid size-6 place-items-center rounded-full bg-muted text-[10px] font-medium">
                {task.assignee.displayName.slice(0, 1).toUpperCase()}
              </span>
              <span className="font-medium text-foreground">{task.assignee.displayName}</span>
              <span>{new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(task.createdAt)}</span>
            </div>
          )}
          <button type="button" onClick={() => onOpen(task)} className="block text-left">
            <h3 className="text-xl font-semibold">{taskTitle(task)}</h3>
            {layout.wrapProperties && task.description && (
              <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                {task.description}
              </p>
            )}
          </button>
          <button
            type="button"
            onClick={() => onOpen(task)}
            className="mt-4 inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
          >
            <MessageCircle className="size-4" />
            Добавить комментарий…
          </button>
        </article>
      ))}
    </div>
  );
}

function MapView({ rows }: { rows: Task[] }): React.ReactElement {
  return (
    <div className="relative min-h-[520px] overflow-hidden border bg-[radial-gradient(circle_at_1px_1px,hsl(var(--border))_1px,transparent_0)] [background-size:24px_24px]">
      <div className="absolute left-3 top-3 rounded-md border bg-background px-2 py-1 text-xs text-muted-foreground">
        Без места ({rows.length})
      </div>
      <div className="absolute right-3 top-3 grid size-8 place-items-center rounded-md border bg-background">
        <MapPin className="size-4 text-muted-foreground" />
      </div>
      <div className="absolute inset-0 grid place-items-center">
        <div className="max-w-sm rounded-xl border bg-background/95 p-5 text-center">
          <MapPin className="mx-auto mb-2 size-5 text-muted-foreground" />
          <p className="text-sm font-medium">Нет задач с местом</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Добавьте свойство «Место» и выберите его в настройке «Показывать карту по».
          </p>
        </div>
      </div>
    </div>
  );
}

type DashboardModule = 'chart' | 'table' | 'list';

function DashboardView({
  rows,
  canEdit,
  modules,
  onModulesChange,
  onOpen,
}: {
  rows: Task[];
  canEdit: boolean;
  modules: DashboardModule[];
  onModulesChange: (modules: DashboardModule[]) => void;
  onOpen: (task: Task) => void;
}): React.ReactElement {
  const [editing, setEditing] = useState(false);
  if (modules.length === 0) {
    return (
      <div className="relative min-h-[460px]">
        {canEdit && (
          <button
            type="button"
            onClick={() => setEditing((value) => !value)}
            className="absolute right-0 top-0 rounded-md border px-2 py-1 text-xs hover:bg-accent"
          >
            {editing ? 'Готово' : 'Изменить'}
          </button>
        )}
        <div className="grid min-h-[420px] place-items-center text-center">
          <div>
            <p className="text-sm text-muted-foreground">Добавьте графики, таблицы и списки</p>
            {editing ? (
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {(
                  [
                    ['chart', BarChart3, 'График'],
                    ['table', Table2, 'Таблица'],
                    ['list', List, 'Список'],
                  ] as const
                ).map(([type, Icon, label]) => (
                  <Button
                    key={type}
                    variant="outline"
                    size="sm"
                    onClick={() => onModulesChange([...modules, type])}
                  >
                    <Icon className="mr-2 size-4" />
                    {label}
                  </Button>
                ))}
              </div>
            ) : (
              canEdit && (
                <Button variant="outline" size="sm" className="mt-4" onClick={() => setEditing(true)}>
                  Изменить дашборд
                </Button>
              )
            )}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div>
      <div className="mb-3 flex justify-end">
        <Button variant="ghost" size="sm" onClick={() => setEditing((value) => !value)}>
          {editing ? 'Готово' : 'Изменить'}
        </Button>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {modules.map((module, index) => (
          <section key={`${module}-${index}`} className="min-h-64 border p-3">
            {editing && (
              <button
                type="button"
                aria-label="Удалить блок"
                onClick={() => onModulesChange(modules.filter((_, i) => i !== index))}
                className="float-right text-muted-foreground hover:text-foreground"
              >
                ×
              </button>
            )}
            {module === 'chart' ? (
              <ChartView rows={rows} />
            ) : (
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  {module === 'table' ? 'Таблица' : 'Список'}
                </p>
                {rows.slice(0, 8).map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => onOpen(task)}
                    className="flex h-9 w-full items-center gap-2 border-b px-2 text-left text-sm hover:bg-accent/50"
                  >
                    <FileText className="size-4 text-muted-foreground" />
                    <span className="truncate">{taskTitle(task)}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

function FormView({
  form,
  onChange,
  canEdit,
  onSubmit,
}: {
  form: ViewFormState;
  onChange: (patch: Partial<ViewFormState>) => void;
  canEdit: boolean;
  onSubmit: (title: string) => Promise<void>;
}): React.ReactElement {
  const [preview, setPreview] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const initialize = (mode: 'properties' | 'scratch'): void => {
    onChange({
      initialized: true,
      questions:
        mode === 'properties'
          ? [
              { id: 'title', label: 'Название', required: true },
              { id: 'status', label: 'Статус', required: false },
              { id: 'deadline', label: 'Срок', required: false },
              { id: 'assignee', label: 'Ответственный', required: false },
            ]
          : [{ id: 'title', label: 'Название', required: true }],
    });
  };
  const share = (): void => {
    void navigator.clipboard
      .writeText(window.location.href)
      .then(() => toast.success('Ссылка на форму скопирована'))
      .catch(() => toast.error('Не удалось скопировать ссылку'));
  };
  const submit = async (): Promise<void> => {
    const first = form.questions.find((question) => values[question.id]?.trim());
    if (!first || busy) return;
    setBusy(true);
    try {
      await onSubmit(values[first.id]!.trim());
      setValues({});
      toast.success('Ответ отправлен — задача создана');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Dialog open={!form.initialized}>
        <DialogContent
          className="max-w-md"
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Создать форму</DialogTitle>
            <DialogDescription>
              Добавьте вопросы из основных свойств проекта или начните с пустой формы.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 pt-2">
            <Button onClick={() => initialize('properties')}>Создать 4 вопроса</Button>
            <Button variant="outline" onClick={() => initialize('scratch')}>
              Начать с нуля
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <div className="mx-auto max-w-3xl pb-12">
      <div className="mb-8 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => setPreview((value) => !value)}>
          <Eye className="mr-2 size-4" />
          {preview ? 'Редактировать' : 'Предпросмотр'}
        </Button>
        <Button size="sm" onClick={share}>
          <Share2 className="mr-2 size-4" />
          Поделиться формой
        </Button>
      </div>
      <div className="text-center">
        {preview || !canEdit ? (
          <h2 className="text-4xl font-semibold">{form.title}</h2>
        ) : (
          <input
            value={form.title}
            onChange={(event) => onChange({ title: event.target.value })}
            aria-label="Название формы"
            className="w-full bg-transparent text-center text-4xl font-semibold outline-none placeholder:text-muted-foreground/30"
            placeholder="Название формы"
          />
        )}
        {preview || !canEdit ? (
          form.description && <p className="mt-3 text-muted-foreground">{form.description}</p>
        ) : (
          <input
            value={form.description}
            onChange={(event) => onChange({ description: event.target.value })}
            aria-label="Описание формы"
            className="mt-3 w-full bg-transparent text-center text-sm outline-none placeholder:text-muted-foreground/50"
            placeholder="Описание (необязательно)"
          />
        )}
      </div>
      <div className="mt-8 rounded-lg bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        Только участники пространства могут заполнить эту форму.
      </div>
      <div className="mt-6 flex flex-col gap-4">
        {form.questions.map((question, index) => (
          <section key={question.id} className="rounded-xl border p-5">
            {preview || !canEdit ? (
              <label className="text-lg font-semibold">
                {question.label}
                {question.required && <span className="ml-1 text-destructive">*</span>}
              </label>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  value={question.label}
                  onChange={(event) =>
                    onChange({
                      questions: form.questions.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, label: event.target.value } : item,
                      ),
                    })
                  }
                  aria-label={`Вопрос ${index + 1}`}
                  className="min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none"
                />
                <label className="text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={question.required}
                    onChange={(event) =>
                      onChange({
                        questions: form.questions.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, required: event.target.checked }
                            : item,
                        ),
                      })
                    }
                    className="mr-1 accent-primary"
                  />
                  Обязательно
                </label>
              </div>
            )}
            <input
              value={values[question.id] ?? ''}
              onChange={(event) =>
                setValues((current) => ({ ...current, [question.id]: event.target.value }))
              }
              disabled={!preview && canEdit}
              placeholder="Ответ"
              className="mt-4 h-11 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:bg-muted/30"
            />
          </section>
        ))}
        {!preview && canEdit && (
          <button
            type="button"
            onClick={() =>
              onChange({
                questions: [
                  ...form.questions,
                  {
                    id: `question-${Date.now()}`,
                    label: 'Новый вопрос',
                    required: false,
                  },
                ],
              })
            }
            className="mx-auto grid size-10 place-items-center rounded-full bg-primary/10 text-primary hover:bg-primary/15"
            aria-label="Добавить вопрос"
          >
            <Plus className="size-5" />
          </button>
        )}
        {preview && (
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? 'Отправка…' : 'Отправить'}
          </Button>
        )}
      </div>
      </div>
    </>
  );
}
