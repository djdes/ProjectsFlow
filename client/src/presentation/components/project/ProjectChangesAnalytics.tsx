import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CalendarClock,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileClock,
  RefreshCw,
  Search,
  SlidersHorizontal,
  UsersRound,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import type { ActivityEventItem } from '@/domain/activity/ActivityFeedItem';
import { formatExactDateTime } from '@/lib/datetime';
import { relativeTime } from '@/lib/relativeTime';
import { UserAvatar } from '@/presentation/components/user/UserAvatar';
import {
  buildProjectChangeAnalytics,
  PROJECT_CHANGE_CATEGORY_LABEL,
  projectChangeSubject,
  projectChangeTitle,
  type ProjectChangeCategory,
  type ProjectChangeSort,
} from './projectChangeAnalytics';

const PAGE_SIZE = 12;
const CATEGORY_OPTIONS: readonly ProjectChangeCategory[] = [
  'all',
  'status',
  'deadline',
  'assignee',
  'description',
  'priority',
  'files',
  'tasks',
  'comments',
  'project',
  'members',
];

const WINDOW_OPTIONS = [7, 28, 90, 3650] as const;
const windowLabel = (days: number): string =>
  days >= 365 ? 'Всё время' : `За ${days} дней`;

function ChangesChart({
  days,
}: {
  days: readonly { date: Date; count: number }[];
}): React.ReactElement {
  const max = Math.max(1, ...days.map((day) => day.count));
  const visibleLabels = days.length <= 14 ? 4 : 5;
  const labelStep = Math.max(1, Math.floor((days.length - 1) / Math.max(1, visibleLabels - 1)));
  return (
    <div className="rounded-2xl border border-border/70 px-3 pb-2 pt-4">
      <div className="flex h-32 items-end gap-1" aria-label="График изменений по дням">
        {days.map((day, index) => {
          const height = day.count === 0 ? 3 : Math.max(8, Math.round((day.count / max) * 112));
          const dateLabel = day.date.toLocaleDateString('ru-RU', {
            day: 'numeric',
            month: 'long',
          });
          return (
            <div
              key={day.date.toISOString()}
              className="group relative flex h-full min-w-0 flex-1 items-end"
              title={`${dateLabel}: ${day.count}`}
              aria-label={`${dateLabel}: ${day.count} изменений`}
            >
              <span
                className="w-full rounded-t-[3px] bg-primary/75 transition-colors group-hover:bg-primary"
                style={{ height }}
              />
              {day.count > 0 ? (
                <span
                  className="pointer-events-none absolute left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-neutral-900 px-2 py-1 text-[11px] text-white group-hover:block"
                  style={{ bottom: height + 6 }}
                >
                  {day.count} · {dateLabel}
                </span>
              ) : null}
              {(index % labelStep === 0 || index === days.length - 1) && (
                <span className="absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] text-muted-foreground">
                  {day.date
                    .toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
                    .replace('.', '')}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className="h-5" />
    </div>
  );
}

function MetricCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: number;
  hint: string;
  icon: typeof FileClock;
}): React.ReactElement {
  return (
    <div className="min-w-0 rounded-2xl border border-border/70 bg-background p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs text-muted-foreground">{label}</span>
        <Icon className="size-4 shrink-0 text-muted-foreground" />
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 truncate text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

type Props = {
  projectId: string;
  activity: readonly ActivityEventItem[];
  loading: boolean;
  loadingHistory: boolean;
  error: string | null;
  windowDays: number;
  onWindowDaysChange: (days: number) => void;
  onRetry: () => void;
};

export function ProjectChangesAnalytics({
  projectId,
  activity,
  loading,
  loadingHistory,
  error,
  windowDays,
  onWindowDaysChange,
  onRetry,
}: Props): React.ReactElement {
  const navigate = useNavigate();
  const [category, setCategory] = useState<ProjectChangeCategory>('all');
  const [actorKey, setActorKey] = useState('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<ProjectChangeSort>('newest');
  const [page, setPage] = useState(1);

  const analytics = useMemo(
    () =>
      buildProjectChangeAnalytics(activity, {
        windowDays,
        category,
        actorKey,
        query,
        sort,
      }),
    [activity, actorKey, category, query, sort, windowDays],
  );
  const actorOptions = useMemo(
    () =>
      buildProjectChangeAnalytics(activity, {
        windowDays,
        category: 'all',
        actorKey: 'all',
        query: '',
        sort: 'newest',
      }).actors,
    [activity, windowDays],
  );
  const breakdown = useMemo(
    () =>
      buildProjectChangeAnalytics(activity, {
        windowDays,
        category: 'all',
        actorKey,
        query,
        sort: 'newest',
      }).breakdown,
    [activity, actorKey, query, windowDays],
  );

  useEffect(() => setPage(1), [actorKey, category, query, sort, windowDays]);
  useEffect(() => {
    if (actorKey !== 'all' && !actorOptions.some((actor) => actor.key === actorKey)) {
      setActorKey('all');
    }
  }, [actorKey, actorOptions]);
  const pageCount = Math.max(1, Math.ceil(analytics.items.length / PAGE_SIZE));
  useEffect(() => setPage((current) => Math.min(current, pageCount)), [pageCount]);
  const pageItems = analytics.items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const selectedActor = actorOptions.find((actor) => actor.key === actorKey);
  const maxBreakdown = Math.max(1, ...breakdown.map((item) => item.count));
  const filtersActive = category !== 'all' || actorKey !== 'all' || query.trim() !== '';

  const resetFilters = (): void => {
    setCategory('all');
    setActorKey('all');
    setQuery('');
    setSort('newest');
  };

  return (
    <section className="space-y-4" aria-labelledby="project-change-analytics-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 id="project-change-analytics-title" className="text-sm font-semibold">
            Изменения
          </h2>
          <p className="text-xs text-muted-foreground">
            Полная история действий и изменений проекта
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="sm" className="h-10 gap-1.5 rounded-xl px-3 text-xs font-normal">
              <CalendarClock className="size-4" />
              {windowLabel(windowDays)}
              <ChevronDown className="size-3.5 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {WINDOW_OPTIONS.map((days) => (
              <DropdownMenuItem key={days} onClick={() => onWindowDaysChange(days)}>
                {windowLabel(days)}
                {windowDays === days && <Check className="ml-auto size-4" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-3" aria-label="Загрузка аналитики изменений">
          {[0, 1, 2, 3].map((value) => (
            <div key={value} className="h-[108px] animate-pulse rounded-2xl border bg-muted/30" />
          ))}
        </div>
      ) : (
        <>
          {error ? (
            <div
              role="alert"
              className="flex min-h-14 items-center justify-between gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3"
            >
              <p className="text-xs text-destructive">{error}</p>
              <Button variant="outline" size="sm" className="h-10 shrink-0 gap-1.5" onClick={onRetry}>
                <RefreshCw className="size-3.5" />
                Повторить
              </Button>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <MetricCard
              label="Событий"
              value={analytics.totalChanges}
              hint={`${analytics.fieldChangeCount} отдельных изменений`}
              icon={FileClock}
            />
            <MetricCard
              label="Задач изменено"
              value={analytics.taskCount}
              hint="уникальных задач"
              icon={SlidersHorizontal}
            />
            <MetricCard
              label="Участников"
              value={analytics.actorCount}
              hint="в выбранном периоде"
              icon={UsersRound}
            />
            <MetricCard
              label="Сегодня"
              value={analytics.todayCount}
              hint={loadingHistory ? 'история ещё загружается' : 'событий за день'}
              icon={CalendarClock}
            />
          </div>

          <ChangesChart days={analytics.perDay} />
          {windowDays >= 365 ? (
            <p className="-mt-2 text-[11px] text-muted-foreground">
              График — последние 30 дней; показатели и список — за всё время.
            </p>
          ) : null}

          {breakdown.length > 0 ? (
            <div className="rounded-2xl border border-border/70 p-4">
              <p className="mb-3 text-xs font-medium text-muted-foreground">Что меняли</p>
              <div className="space-y-2.5">
                {breakdown.slice(0, 6).map((item) => (
                  <button
                    key={item.category}
                    type="button"
                    onClick={() => setCategory(item.category)}
                    className="group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 text-left"
                  >
                    <span className="truncate text-xs group-hover:text-primary">
                      {PROJECT_CHANGE_CATEGORY_LABEL[item.category]}
                    </span>
                    <span className="text-xs tabular-nums text-muted-foreground">{item.count}</span>
                    <span className="col-span-2 mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                      <span
                        className="block h-full rounded-full bg-primary/70 transition-[width]"
                        style={{ width: `${Math.max(4, (item.count / maxBreakdown) * 100)}%` }}
                      />
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Поиск по задаче, человеку или изменению…"
                aria-label="Поиск по изменениям"
                className="h-10 rounded-xl pl-9"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-10 min-w-0 gap-1.5 rounded-xl px-3 text-xs font-normal">
                    <SlidersHorizontal className="size-3.5 shrink-0" />
                    <span className="truncate">{PROJECT_CHANGE_CATEGORY_LABEL[category]}</span>
                    <ChevronDown className="size-3.5 shrink-0 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
                  {CATEGORY_OPTIONS.map((value) => (
                    <DropdownMenuItem key={value} onClick={() => setCategory(value)}>
                      {PROJECT_CHANGE_CATEGORY_LABEL[value]}
                      {category === value && <Check className="ml-auto size-4" />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-10 min-w-0 gap-1.5 rounded-xl px-3 text-xs font-normal">
                    <UsersRound className="size-3.5 shrink-0" />
                    <span className="max-w-32 truncate">{selectedActor?.name ?? 'Все участники'}</span>
                    <ChevronDown className="size-3.5 shrink-0 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-80 min-w-56 overflow-y-auto">
                  <DropdownMenuItem onClick={() => setActorKey('all')}>
                    Все участники
                    {actorKey === 'all' && <Check className="ml-auto size-4" />}
                  </DropdownMenuItem>
                  {actorOptions.map((actor) => (
                    <DropdownMenuItem key={actor.key} onClick={() => setActorKey(actor.key)}>
                      <UserAvatar
                        displayName={actor.name}
                        avatarUrl={actor.avatarUrl}
                        className="mr-1 size-5 rounded-full text-[9px]"
                      />
                      <span className="min-w-0 flex-1 truncate">{actor.name}</span>
                      <span className="text-xs text-muted-foreground">{actor.count}</span>
                      {actorKey === actor.key && <Check className="size-4" />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="ml-auto h-10 gap-1.5 rounded-xl px-3 text-xs font-normal">
                    {sort === 'newest' ? 'Сначала новые' : 'Сначала старые'}
                    <ChevronDown className="size-3.5 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setSort('newest')}>
                    Сначала новые
                    {sort === 'newest' && <Check className="ml-auto size-4" />}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSort('oldest')}>
                    Сначала старые
                    {sort === 'oldest' && <Check className="ml-auto size-4" />}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <div role="table" aria-label="Изменения проекта" className="overflow-hidden rounded-2xl border border-border/70">
            <div
              role="row"
              className="sticky top-0 z-10 grid h-12 grid-cols-[minmax(0,1fr)_8.5rem] items-center border-b bg-background/95 px-4 text-xs font-medium text-muted-foreground backdrop-blur"
            >
              <span role="columnheader">Изменение</span>
              <span role="columnheader">Кто и когда</span>
            </div>
            {pageItems.length === 0 ? (
              <div className="grid min-h-36 place-items-center px-6 py-8 text-center">
                <div>
                  <p className="text-sm font-medium">
                    {activity.length === 0 ? 'Изменений пока нет' : 'Ничего не найдено'}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {activity.length === 0
                      ? 'Новые действия появятся здесь автоматически.'
                      : 'Измените фильтры или поисковый запрос.'}
                  </p>
                  {filtersActive ? (
                    <Button variant="ghost" size="sm" className="mt-2 h-10" onClick={resetFilters}>
                      Сбросить фильтры
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : (
              pageItems.map((item) => {
                const taskId = item.payload?.taskId;
                return (
                  <div
                    key={item.id}
                    role="row"
                    tabIndex={taskId ? 0 : undefined}
                    onClick={() => taskId && navigate(`/projects/${projectId}/tasks/${taskId}`)}
                    onKeyDown={(event) => {
                      if (!taskId || (event.key !== 'Enter' && event.key !== ' ')) return;
                      event.preventDefault();
                      navigate(`/projects/${projectId}/tasks/${taskId}`);
                    }}
                    className={`grid min-h-[52px] grid-cols-[minmax(0,1fr)_8.5rem] items-center gap-3 border-b px-4 py-2.5 last:border-b-0 ${
                      taskId
                        ? 'cursor-pointer transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring'
                        : ''
                    }`}
                  >
                    <span role="cell" className="min-w-0">
                      <span className="block truncate text-sm font-medium">{projectChangeTitle(item)}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {projectChangeSubject(item)}
                      </span>
                    </span>
                    <span role="cell" className="min-w-0">
                      <span className="flex items-center gap-1.5">
                        <UserAvatar
                          displayName={item.actorDisplayName ?? 'Система'}
                          avatarUrl={item.actorAvatarUrl}
                          className="size-5 shrink-0 rounded-full text-[9px]"
                        />
                        <span className="min-w-0 truncate text-xs">
                          {item.actorDisplayName ?? 'Система'}
                        </span>
                      </span>
                      <span
                        className="mt-0.5 block truncate pl-6 text-[11px] text-muted-foreground"
                        title={formatExactDateTime(item.createdAt)}
                      >
                        {relativeTime(item.createdAt)}
                      </span>
                    </span>
                  </div>
                );
              })
            )}
          </div>

          {analytics.items.length > PAGE_SIZE ? (
            <div className="flex min-h-11 items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">
                {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, analytics.items.length)} из{' '}
                {analytics.items.length}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-10 rounded-xl"
                  disabled={page <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  aria-label="Предыдущая страница"
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <span className="min-w-12 text-center text-xs tabular-nums">
                  {page} / {pageCount}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-10 rounded-xl"
                  disabled={page >= pageCount}
                  onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
                  aria-label="Следующая страница"
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
