import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDownUp,
  Bot,
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
import type { TaskVersion, TaskVersionField, TaskVersionsResult } from '@/domain/task/TaskVersion';
import { useContainer } from '@/infrastructure/di/container';
import { cn } from '@/lib/utils';
import { STATUS_LABEL } from '@/presentation/components/tasks/statusLabels';
import { TaskVersionPreview } from '@/presentation/components/tasks/TaskVersionsDialog';
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [visibleFields, setVisibleFields] = useState<Set<TaskVersionField>>(
    () => new Set(ALL_VERSION_FIELDS),
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let requestId = 0;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let latestVersionId: string | null = null;

    setLoading(true);
    setLoadError(false);
    setData(null);
    setQuery('');
    setTaskFilter('all');
    setActorFilter('all');
    setSortOrder('newest');
    setSelectedId(null);
    setVisibleFields(new Set(ALL_VERSION_FIELDS));

    const load = (initial: boolean): void => {
      const currentRequestId = ++requestId;
      taskRepository
        .getProjectVersions(projectId)
        .then((result) => {
          if (cancelled || currentRequestId !== requestId) return;
          const previousLatestId = latestVersionId;
          latestVersionId = result.versions[0]?.id ?? null;
          setData(result);
          setSelectedId((current) => {
            const stillExists =
              !!current && result.versions.some((version) => version.id === current);
            if (initial || !stillExists || current === previousLatestId) return latestVersionId;
            return current;
          });
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
  const selected =
    visibleVersions.find((version) => version.id === selectedId && !isLocked(version)) ?? null;

  useEffect(() => {
    if (!data || selected) return;
    const firstAvailable = visibleVersions.find((version) => !isLocked(version));
    setSelectedId(firstAvailable?.id ?? null);
  }, [data, isLocked, selected, visibleVersions]);

  const previousSnapshot = useMemo(() => {
    if (!data || !selected) return null;
    const taskVersions = data.versions
      .filter((version) => version.taskId === selected.taskId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
    const selectedIndex = taskVersions.findIndex((version) => version.id === selected.id);
    return selectedIndex >= 0 ? taskVersions[selectedIndex + 1]?.snapshot ?? null : null;
  }, [data, selected]);

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
      <DialogContent
        overlayClassName="bg-black/70 backdrop-blur-[1px]"
        className="flex h-[92dvh] w-[94vw] max-w-[94vw] flex-col gap-0 overflow-hidden p-0 shadow-[0_24px_80px_rgba(0,0,0,0.55)] sm:rounded-xl"
      >
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

        <div className="flex min-h-0 flex-1 bg-muted/10">
          {loading ? (
            <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Загрузка истории…
            </div>
          ) : loadError ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <p className="text-sm text-muted-foreground">Не удалось загрузить историю версий.</p>
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                Закрыть
              </Button>
            </div>
          ) : visibleVersions.length === 0 ? (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              Нет версий по выбранным фильтрам.
            </div>
          ) : (
            <>
              <div className="min-w-0 flex-1 overflow-y-auto bg-background px-8 py-6 sm:px-12 sm:py-8">
                {selected ? (
                  <>
                    <div className="mx-auto mb-6 flex max-w-2xl items-center justify-between gap-3 border-b pb-4">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {snapshotTaskTitle(selected.snapshot)}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {selected.actor?.displayName ?? 'Система'} ·{' '}
                          {formatDateTime(selected.createdAt)} ·{' '}
                          {changedFieldsLabel(selected.changedFields)}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        onClick={() => onOpenTask(selected.taskId)}
                      >
                        <ExternalLink className="size-4" />
                        Открыть задачу
                      </Button>
                    </div>
                    <TaskVersionPreview
                      snapshot={selected.snapshot}
                      prev={previousSnapshot}
                    />
                  </>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                    <Lock className="size-5 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      Выберите доступную версию задачи.
                    </p>
                    {hasLocked && (
                      <Button variant="outline" size="sm" onClick={() => upgrade.open()}>
                        Улучшить план
                      </Button>
                    )}
                  </div>
                )}
              </div>

              <div className="flex w-80 shrink-0 flex-col border-l bg-background xl:w-96">
                <ol className="min-h-0 flex-1 overflow-y-auto p-1.5">
                  {visibleVersions.map((version) => {
                    const locked = isLocked(version);
                    return (
                      <li key={version.id}>
                        <button
                          type="button"
                          disabled={locked}
                          onClick={() => setSelectedId(version.id)}
                          className={cn(
                            'flex w-full items-start justify-between gap-2 rounded-md px-2.5 py-2.5 text-left text-sm transition-colors',
                            locked
                              ? 'cursor-not-allowed text-muted-foreground/60'
                              : 'hover:bg-accent',
                            version.id === selectedId && !locked && 'bg-accent',
                          )}
                        >
                          <span className="flex min-w-0 flex-1 flex-col gap-1">
                            <span
                              className="truncate font-semibold"
                              title={snapshotTaskTitle(version.snapshot)}
                            >
                              {snapshotTaskTitle(version.snapshot)}
                            </span>
                            <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                              {version.actor ? (
                                <UserAvatar
                                  displayName={version.actor.displayName}
                                  avatarUrl={version.actor.avatarUrl}
                                  className="size-5 text-[8px]"
                                />
                              ) : (
                                <span className="flex size-5 shrink-0 items-center justify-center rounded bg-muted">
                                  <Bot className="size-3" />
                                </span>
                              )}
                              <span className="truncate">
                                {version.actor?.displayName ?? 'Система'}
                              </span>
                              <span className="shrink-0">{formatDateTime(version.createdAt)}</span>
                            </span>
                            <span
                              className="truncate text-[11px] leading-4 text-muted-foreground"
                              title={changedFieldsLabel(version.changedFields)}
                            >
                              {changedFieldsLabel(version.changedFields)}
                            </span>
                          </span>
                          {locked && (
                            <Lock className="mt-1 size-3.5 shrink-0 text-muted-foreground" />
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ol>
                {hasLocked && (
                  <div className="border-t p-3 text-center text-xs text-muted-foreground">
                    <p className="mb-2">
                      История 7 дней. Версии старше — на тарифе Прайм или ВИП.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => upgrade.open()}
                    >
                      Улучшить план
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
