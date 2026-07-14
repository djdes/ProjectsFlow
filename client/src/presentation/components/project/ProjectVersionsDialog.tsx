import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDownUp,
  Bot,
  CalendarDays,
  ExternalLink,
  History,
  ListFilter,
  Loader2,
  Lock,
  Search,
  UserRound,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { PRIORITY_META } from '@/domain/task/priorityMeta';
import type { TaskVersion, TaskVersionField, TaskVersionsResult } from '@/domain/task/TaskVersion';
import { useContainer } from '@/infrastructure/di/container';
import { STATUS_LABEL } from '@/presentation/components/tasks/statusLabels';
import {
  ALL_VERSION_FIELDS,
  VERSION_FIELD_OPTIONS,
  changedFieldsLabel,
  snapshotTaskTitle,
} from '@/presentation/components/tasks/taskVersionLabels';
import { UserAvatar } from '@/presentation/components/user/UserAvatar';
import {
  PROJECT_CHANGED_EVENT,
  TASK_CHANGED_EVENT,
  TASK_VERSION_CHANGED_EVENT,
} from '@/presentation/hooks/useNotificationStream';
import { useUpgradeDialog } from '@/presentation/usage/UpgradeDialogProvider';

type SortOrder = 'newest' | 'oldest';

type Props = {
  projectId: string;
  projectName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenTask: (taskId: string) => void;
};

function formatDateTime(date: Date): string {
  return date.toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatTaskDates(startDate: string | null, deadline: string | null): string {
  if (!startDate && !deadline) return 'Без дедлайна';
  const format = (value: string): string =>
    new Date(`${value}T00:00:00`).toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  if (startDate && deadline) return `${format(startDate)} — ${format(deadline)}`;
  if (deadline) return `до ${format(deadline)}`;
  return `с ${format(startDate!)}`;
}

function actorKey(version: TaskVersion): string {
  return version.actorUserId ?? 'system';
}

export function ProjectVersionsDialog({
  projectId,
  projectName,
  open,
  onOpenChange,
  onOpenTask,
}: Props): React.ReactElement {
  const { taskRepository } = useContainer();
  const upgrade = useUpgradeDialog();
  const [data, setData] = useState<TaskVersionsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState('');
  const [taskFilter, setTaskFilter] = useState('all');
  const [actorFilter, setActorFilter] = useState('all');
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest');
  const [visibleFields, setVisibleFields] = useState<Set<TaskVersionField>>(
    () => new Set(ALL_VERSION_FIELDS),
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let requestId = 0;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

    setLoading(true);
    setLoadError(false);
    setData(null);
    setQuery('');
    setTaskFilter('all');
    setActorFilter('all');
    setSortOrder('newest');
    setVisibleFields(new Set(ALL_VERSION_FIELDS));

    const load = (initial: boolean): void => {
      const currentRequestId = ++requestId;
      taskRepository
        .getProjectVersions(projectId)
        .then((result) => {
          if (cancelled || currentRequestId !== requestId) return;
          setData(result);
          setLoadError(false);
        })
        .catch(() => {
          if (cancelled || currentRequestId !== requestId) return;
          if (initial) setLoadError(true);
        })
        .finally(() => {
          if (!cancelled && currentRequestId === requestId) setLoading(false);
        });
    };

    const scheduleRefresh = (): void => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => load(false), 80);
    };
    const onChanged = (event: Event): void => {
      const detail = (event as CustomEvent<{ projectId?: string }>).detail;
      if (detail?.projectId && detail.projectId !== projectId) return;
      scheduleRefresh();
    };

    load(true);
    window.addEventListener(TASK_VERSION_CHANGED_EVENT, onChanged);
    window.addEventListener(TASK_CHANGED_EVENT, onChanged);
    window.addEventListener(PROJECT_CHANGED_EVENT, onChanged);
    window.addEventListener('pf:project-activity-changed', onChanged);
    return () => {
      cancelled = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      window.removeEventListener(TASK_VERSION_CHANGED_EVENT, onChanged);
      window.removeEventListener(TASK_CHANGED_EVENT, onChanged);
      window.removeEventListener(PROJECT_CHANGED_EVENT, onChanged);
      window.removeEventListener('pf:project-activity-changed', onChanged);
    };
  }, [open, projectId, taskRepository]);

  const taskOptions = useMemo(() => {
    const options = new Map<string, string>();
    for (const version of data?.versions ?? []) {
      if (!options.has(version.taskId)) {
        options.set(version.taskId, snapshotTaskTitle(version.snapshot));
      }
    }
    return [...options].map(([id, title]) => ({ id, title }));
  }, [data]);

  const actorOptions = useMemo(() => {
    const options = new Map<string, { displayName: string; avatarUrl: string | null }>();
    for (const version of data?.versions ?? []) {
      const key = actorKey(version);
      if (!options.has(key)) {
        options.set(key, {
          displayName: version.actor?.displayName ?? 'Система',
          avatarUrl: version.actor?.avatarUrl ?? null,
        });
      }
    }
    return [...options].map(([id, actor]) => ({ id, ...actor }));
  }, [data]);

  const visibleVersions = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('ru-RU');
    const versions = (data?.versions ?? []).filter((version) => {
      if (!version.changedFields.some((field) => visibleFields.has(field))) return false;
      if (taskFilter !== 'all' && version.taskId !== taskFilter) return false;
      if (actorFilter !== 'all' && actorKey(version) !== actorFilter) return false;
      if (!normalizedQuery) return true;

      const searchable = [
        snapshotTaskTitle(version.snapshot),
        version.snapshot.description ?? '',
        version.actor?.displayName ?? 'Система',
        version.snapshot.assignee.displayName,
        STATUS_LABEL[version.snapshot.status],
        changedFieldsLabel(version.changedFields),
      ]
        .join(' ')
        .toLocaleLowerCase('ru-RU');
      return searchable.includes(normalizedQuery);
    });
    return [...versions].sort((left, right) =>
      sortOrder === 'newest'
        ? right.createdAt.getTime() - left.createdAt.getTime()
        : left.createdAt.getTime() - right.createdAt.getTime(),
    );
  }, [actorFilter, data, query, sortOrder, taskFilter, visibleFields]);

  const isLocked = useCallback(
    (version: TaskVersion): boolean =>
      !!data?.cutoffAt && version.createdAt.getTime() < data.cutoffAt.getTime(),
    [data],
  );
  const hasLocked = (data?.versions ?? []).some(isLocked);

  const toggleField = (field: TaskVersionField, checked: boolean): void => {
    setVisibleFields((current) => {
      const next = new Set(current);
      if (checked) next.add(field);
      else next.delete(field);
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[88vh] w-[96vw] max-w-6xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-5 py-4 pr-12">
          <DialogTitle className="flex items-center gap-2">
            <History className="size-5 text-muted-foreground" />
            История версий проекта
          </DialogTitle>
          <p className="truncate text-xs text-muted-foreground">{projectName}</p>
        </DialogHeader>

        <div className="shrink-0 space-y-2 border-b bg-muted/20 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-56 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Поиск по задачам и изменениям…"
                className="h-9 pl-9"
              />
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <ListFilter className="size-4" />
                  {visibleFields.size === ALL_VERSION_FIELDS.length
                    ? 'Все изменения'
                    : `Типы: ${visibleFields.size}`}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-[65vh] w-64 overflow-y-auto">
                <DropdownMenuLabel>Тип изменения</DropdownMenuLabel>
                <DropdownMenuCheckboxItem
                  checked={visibleFields.size === ALL_VERSION_FIELDS.length}
                  onCheckedChange={(checked) =>
                    setVisibleFields(
                      checked ? new Set(ALL_VERSION_FIELDS) : new Set<TaskVersionField>(),
                    )
                  }
                  onSelect={(event) => event.preventDefault()}
                >
                  Все типы
                </DropdownMenuCheckboxItem>
                <DropdownMenuSeparator />
                {VERSION_FIELD_OPTIONS.map((option) => (
                  <DropdownMenuCheckboxItem
                    key={option.field}
                    checked={visibleFields.has(option.field)}
                    onCheckedChange={(checked) => toggleField(option.field, checked === true)}
                    onSelect={(event) => event.preventDefault()}
                  >
                    {option.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <History className="size-4" />
                  {taskFilter === 'all'
                    ? 'Все задачи'
                    : taskOptions.find((task) => task.id === taskFilter)?.title ?? 'Задача'}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-[65vh] w-72 overflow-y-auto">
                <DropdownMenuLabel>Задача</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={taskFilter} onValueChange={setTaskFilter}>
                  <DropdownMenuRadioItem value="all">Все задачи</DropdownMenuRadioItem>
                  <DropdownMenuSeparator />
                  {taskOptions.map((task) => (
                    <DropdownMenuRadioItem key={task.id} value={task.id}>
                      <span className="truncate" title={task.title}>{task.title}</span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <UserRound className="size-4" />
                  {actorFilter === 'all'
                    ? 'Кем изменено'
                    : actorOptions.find((actor) => actor.id === actorFilter)?.displayName ??
                      'Автор'}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-[65vh] w-60 overflow-y-auto">
                <DropdownMenuLabel>Кем изменено</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={actorFilter} onValueChange={setActorFilter}>
                  <DropdownMenuRadioItem value="all">Все</DropdownMenuRadioItem>
                  <DropdownMenuSeparator />
                  {actorOptions.map((actor) => (
                    <DropdownMenuRadioItem key={actor.id} value={actor.id}>
                      {actor.displayName}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <ArrowDownUp className="size-4" />
                  {sortOrder === 'newest' ? 'Сначала новые' : 'Сначала старые'}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel>Сортировка</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={sortOrder}
                  onValueChange={(value) => setSortOrder(value as SortOrder)}
                >
                  <DropdownMenuRadioItem value="newest">Сначала новые</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="oldest">Сначала старые</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>
              Показано {visibleVersions.length} из {data?.versions.length ?? 0} версий
            </span>
            {hasLocked && (
              <button type="button" className="hover:text-foreground" onClick={() => upgrade.open()}>
                История старше 7 дней доступна на Прайм и ВИП
              </button>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-muted/10 p-3 sm:p-5">
          {loading ? (
            <div className="flex h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Загрузка истории…
            </div>
          ) : loadError ? (
            <div className="flex h-40 flex-col items-center justify-center gap-3 text-center">
              <p className="text-sm text-muted-foreground">Не удалось загрузить историю версий.</p>
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                Закрыть
              </Button>
            </div>
          ) : visibleVersions.length === 0 ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              Нет версий по выбранным фильтрам.
            </div>
          ) : (
            <ol className="mx-auto max-w-4xl space-y-3">
              {visibleVersions.map((version) => {
                const locked = isLocked(version);
                const priority = version.snapshot.priority
                  ? PRIORITY_META[version.snapshot.priority]
                  : null;
                return (
                  <li key={version.id}>
                    <article className="rounded-xl border bg-background p-4 shadow-sm">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-3">
                          {version.actor ? (
                            <UserAvatar
                              displayName={version.actor.displayName}
                              avatarUrl={version.actor.avatarUrl}
                              className="mt-0.5 size-8 text-[10px]"
                            />
                          ) : (
                            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
                              <Bot className="size-4 text-muted-foreground" />
                            </span>
                          )}
                          <div className="min-w-0">
                            <h3 className="truncate text-sm font-semibold" title={snapshotTaskTitle(version.snapshot)}>
                              {snapshotTaskTitle(version.snapshot)}
                            </h3>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {version.actor?.displayName ?? 'Система'} · {formatDateTime(version.createdAt)}
                            </p>
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="shrink-0"
                          onClick={() => onOpenTask(version.taskId)}
                        >
                          <ExternalLink className="size-4" />
                          Открыть задачу
                        </Button>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {version.changedFields.map((field) => {
                          const label = VERSION_FIELD_OPTIONS.find(
                            (option) => option.field === field,
                          )?.label;
                          return (
                            <span
                              key={field}
                              className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[11px] font-medium text-blue-700 dark:text-blue-300"
                            >
                              {label ?? field}
                            </span>
                          );
                        })}
                      </div>

                      {locked ? (
                        <button
                          type="button"
                          onClick={() => upgrade.open()}
                          className="mt-3 flex w-full items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted"
                        >
                          <Lock className="size-3.5" />
                          Снимок этой версии старше 7 дней — открыть на тарифе Прайм или ВИП
                        </button>
                      ) : (
                        <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
                          <span className="rounded-lg bg-muted/50 px-3 py-2">
                            <span className="block text-[10px] uppercase tracking-wide">Статус</span>
                            <span className="mt-0.5 block truncate font-medium text-foreground">
                              {STATUS_LABEL[version.snapshot.status]}
                            </span>
                          </span>
                          <span className="rounded-lg bg-muted/50 px-3 py-2">
                            <span className="block text-[10px] uppercase tracking-wide">Ответственный</span>
                            <span className="mt-0.5 block truncate font-medium text-foreground">
                              {version.snapshot.assignee.displayName}
                            </span>
                          </span>
                          <span className="rounded-lg bg-muted/50 px-3 py-2">
                            <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide">
                              <CalendarDays className="size-3" /> Даты
                            </span>
                            <span className="mt-0.5 block truncate font-medium text-foreground">
                              {formatTaskDates(version.snapshot.startDate, version.snapshot.deadline)}
                            </span>
                          </span>
                          <span className="rounded-lg bg-muted/50 px-3 py-2">
                            <span className="block text-[10px] uppercase tracking-wide">Приоритет</span>
                            <span className="mt-0.5 block truncate font-medium text-foreground">
                              {priority?.label ?? 'Не выбран'}
                            </span>
                          </span>
                        </div>
                      )}
                    </article>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
