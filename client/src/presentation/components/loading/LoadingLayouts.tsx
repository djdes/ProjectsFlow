import { useLocation } from 'react-router-dom';
import { LoadingRegion, Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  loadingLayoutForPath,
  projectLoadingLayout,
  type LoadingLayout,
} from '@/lib/loadingLayout';

const widths = ['w-3/4', 'w-1/2', 'w-2/3'];

export function MemberListSkeleton({
  rows = 3,
}: {
  rows?: number;
}): React.ReactElement {
  return (
    <LoadingRegion label="Загружаем участников…" className="space-y-4 py-3">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 py-3">
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className={cn('h-3.5 max-w-48', widths[i % 3])} />
            <Skeleton className="h-3 w-2/5 max-w-32" />
          </div>
          <Skeleton className="h-7 w-20" />
        </div>
      ))}
    </LoadingRegion>
  );
}

export function BoardSkeleton({
  className,
  shelf = true,
  columns = 3,
}: {
  className?: string;
  shelf?: boolean;
  columns?: number;
}): React.ReactElement {
  return (
    <LoadingRegion
      label="Загружаем задачи…"
      className={cn('min-w-0 space-y-4', className)}
    >
      {shelf && (
        <div className="mbe-4 rounded-xl bg-muted/35 p-3">
          <Skeleton className="mbe-3 h-3 w-20" />
          <div className="max-w-72 rounded-lg border border-border/50 bg-background p-3">
            <Skeleton className="h-3.5 w-4/5" />
            <Skeleton className="mbs-2 h-3 w-3/5" />
          </div>
        </div>
      )}
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: columns }, (_, col) => (
          <div
            key={col}
            className="w-full shrink-0 space-y-2 rounded-xl bg-muted/40 p-2 sm:w-[276px]"
          >
            <div className="flex h-9 items-center justify-between px-1">
              <Skeleton className="h-5 w-24 rounded-full" />
              <Skeleton className="size-4" />
            </div>
            {Array.from({ length: col === 1 ? 2 : 3 }, (_, row) => (
              <div
                key={row}
                className="space-y-2.5 rounded-lg border border-border/50 bg-background p-3"
              >
                <Skeleton className={cn('h-3.5', widths[(col + row) % 3])} />
                <Skeleton className="h-3 w-5/6" />
                {row === 0 && <Skeleton className="h-3 w-2/3" />}
                <div className="flex items-center justify-between pbs-2">
                  <Skeleton className="h-4 w-14 rounded-full" />
                  <Skeleton className="size-5 rounded-full" />
                </div>
              </div>
            ))}
            <Skeleton className="my-2 h-8 w-full bg-muted/50" />
          </div>
        ))}
      </div>
    </LoadingRegion>
  );
}

export function TableSkeleton({
  rows = 7,
}: {
  rows?: number;
}): React.ReactElement {
  return (
    <LoadingRegion
      label="Загружаем таблицу…"
      className="overflow-clip rounded-lg border border-border/60"
    >
      <div className="grid grid-cols-[minmax(10rem,2fr)_1fr_1fr] gap-8 border-be bg-muted/35 px-4 py-3">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-20" />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="grid h-12 grid-cols-[minmax(10rem,2fr)_1fr_1fr] items-center gap-8 border-be px-4 last:border-0"
        >
          <Skeleton className={cn('h-3.5', widths[i % 3])} />
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
    </LoadingRegion>
  );
}

export function ListSkeleton({
  rows = 6,
}: {
  rows?: number;
}): React.ReactElement {
  return (
    <LoadingRegion label="Загружаем список…">
      <div className="divide-y rounded-lg border border-border/60">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex min-h-14 items-center gap-3 px-4">
            <Skeleton className="size-4 shrink-0" />
            <Skeleton className={cn('h-3.5 max-w-md flex-1', widths[i % 3])} />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </LoadingRegion>
  );
}

export function CalendarSkeleton(): React.ReactElement {
  return (
    <LoadingRegion label="Загружаем календарь…">
      <div className="mbe-4 flex justify-between">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-7 w-24" />
      </div>
      <div className="grid grid-cols-7 overflow-clip rounded-lg border">
        {Array.from({ length: 35 }, (_, i) => (
          <div
            key={i}
            className="min-h-20 space-y-3 border-be border-e p-2 sm:min-h-28"
          >
            <Skeleton className="size-3" />
            {i % 3 === 0 && <Skeleton className="h-5 w-full" />}
          </div>
        ))}
      </div>
    </LoadingRegion>
  );
}

export function ProjectViewSkeleton({
  projectId,
  viewId,
}: {
  projectId: string;
  viewId?: string;
}): React.ReactElement {
  const layout = projectLoadingLayout(projectId, viewId);
  return layout === 'table' ? (
    <TableSkeleton />
  ) : layout === 'list' ? (
    <ListSkeleton />
  ) : layout === 'calendar' ? (
    <CalendarSkeleton />
  ) : (
    <BoardSkeleton />
  );
}

export function DocumentSkeleton(): React.ReactElement {
  return (
    <LoadingRegion label="Загружаем содержимое…" className="space-y-6">
      <Skeleton className="h-7 w-2/3 max-w-md" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="space-y-3 py-2">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-11/12" />
          <Skeleton className="h-3 w-3/4" />
        </div>
      ))}
    </LoadingRegion>
  );
}

export function PageSkeleton({
  layout = 'board',
}: {
  layout?: LoadingLayout;
}): React.ReactElement {
  if (layout === 'studio')
    return (
      <LoadingRegion
        label="Открываем Студию…"
        className="flex h-full min-h-[520px] flex-col"
      >
        <div className="flex h-12 items-center justify-between border-be px-4">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-8 w-28" />
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[1fr_360px]">
          <div className="space-y-5 bg-muted/25 p-6">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-[50dvh] w-full rounded-xl" />
          </div>
          <div className="hidden flex-col justify-between gap-6 border-s p-5 md:flex">
            <DocumentSkeleton />
            <Skeleton className="h-24 w-full rounded-xl" />
          </div>
        </div>
      </LoadingRegion>
    );
  if (layout === 'auth')
    return (
      <LoadingRegion
        label="Загружаем страницу…"
        className="grid min-h-dvh place-items-center p-6"
      >
        <div className="w-full max-w-sm space-y-6">
          <Skeleton className="mx-auto size-12 rounded-xl" />
          <Skeleton className="mx-auto h-7 w-48" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      </LoadingRegion>
    );
  if (layout === 'settings')
    return (
      <div
        data-pf-page-skeleton={layout}
        className="mx-auto w-full max-w-2xl space-y-6 px-4 pbe-12 pbs-3.5 sm:px-6"
      >
        <LoadingRegion label="Загружаем настройки…">
          <Skeleton className="h-9 w-20" />
          <div className="mbs-6 flex items-center gap-3">
            <Skeleton className="size-9" />
            <Skeleton className="h-7 w-48" />
          </div>
        </LoadingRegion>
        <div className="space-y-5 rounded-xl border p-6">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="ms-auto h-9 w-24" />
        </div>
        <div className="rounded-xl border p-6">
          <Skeleton className="h-5 w-36" />
          <MemberListSkeleton />
        </div>
      </div>
    );
  if (layout === 'document')
    return (
      <div
        data-pf-page-skeleton={layout}
        className="grid h-full min-w-0 grid-cols-1 md:grid-cols-[280px_1fr]"
      >
        <aside className="hidden space-y-5 border-e p-3 md:block">
          <Skeleton className="h-8 w-full" />
          <ListSkeleton rows={5} />
        </aside>
        <div className="min-w-0 space-y-6 p-4 md:p-6">
          <Skeleton className="h-8 w-48" />
          <DocumentSkeleton />
        </div>
      </div>
    );
  if (layout === 'dashboard')
    return (
      <div
        data-pf-page-skeleton={layout}
        className="space-y-6 p-4 pbs-3.5 sm:p-6 sm:pbs-4"
      >
        <LoadingRegion label="Загружаем показатели…">
          <div className="mbe-6 flex items-center gap-3">
            <Skeleton className="size-9" />
            <Skeleton className="h-7 w-48" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-4 rounded-xl border p-5">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-8 w-28" />
                <Skeleton className="h-3 w-32" />
              </div>
            ))}
          </div>
        </LoadingRegion>
        <TableSkeleton rows={5} />
      </div>
    );
  const narrow = ['overview', 'task'].includes(layout);
  return (
    <div className="min-h-full min-w-0" data-pf-page-skeleton={layout}>
      <div className="flex h-11 items-center gap-3 px-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-32" />
      </div>
      <div
        className={cn(
          'px-6 pbe-10 sm:px-14 lg:px-24',
          layout === 'inbox' ? 'pbs-2' : layout === 'overview' ? 'pbs-1' : 'pbs-9',
        )}
      >
        <div className={cn('space-y-6', narrow && 'mx-auto max-w-4xl')}>
          <LoadingRegion label="Загружаем страницу…">
            <div className="space-y-4">
              <Skeleton
                className={cn(
                  'w-2/3 max-w-sm',
                  layout === 'inbox' ? 'h-6' : 'h-9',
                )}
              />
              <Skeleton className="h-3.5 w-1/2 max-w-xs" />
              <div className="flex items-center justify-between pbs-2">
                <div className="flex gap-2">
                  <Skeleton className="h-8 w-24 rounded-full" />
                  <Skeleton className="h-8 w-20 rounded-full" />
                </div>
                <Skeleton className="h-8 w-24" />
              </div>
            </div>
          </LoadingRegion>
          {(layout === 'board' || layout === 'inbox') && (
            <BoardSkeleton shelf={layout !== 'inbox'} />
          )}
          {layout === 'table' && <TableSkeleton />}
          {layout === 'list' && <ListSkeleton />}
          {layout === 'calendar' && <CalendarSkeleton />}
          {layout === 'overview' && (
            <>
              <div className="space-y-5 rounded-xl border p-5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="ms-auto h-9 w-24" />
              </div>
              <div className="rounded-xl border p-5">
                <Skeleton className="h-4 w-28" />
                <MemberListSkeleton />
              </div>
            </>
          )}
          {layout === 'task' && (
            <>
              <DocumentSkeleton />
              <MemberListSkeleton rows={2} />
            </>
          )}
          {layout === 'chat' && (
            <LoadingRegion className="mx-auto flex min-h-[55dvh] max-w-3xl flex-col justify-between">
              <div className="space-y-8">
                <Skeleton className="ms-auto h-16 w-2/3 rounded-2xl" />
                <DocumentSkeleton />
              </div>
              <Skeleton className="mbs-12 h-24 w-full rounded-2xl" />
            </LoadingRegion>
          )}
        </div>
      </div>
    </div>
  );
}

export function RouteSkeleton(): React.ReactElement {
  const { pathname, search } = useLocation();
  const project = /^\/projects\/([^/]+)\/?$/.exec(pathname);
  const layout = project
    ? projectLoadingLayout(project[1], new URLSearchParams(search).get('view'))
    : loadingLayoutForPath(pathname);
  return <PageSkeleton layout={layout} />;
}

export function SidebarSkeleton(): React.ReactElement {
  return (
    <LoadingRegion label="Загружаем проекты…" className="space-y-6 px-2 py-4">
      {[0, 1].map((section) => (
        <div key={section} className="space-y-4">
          <Skeleton className="h-3 w-24" />
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex items-center gap-2.5">
              <Skeleton className="size-6 shrink-0" />
              <Skeleton className={cn('h-3', widths[row])} />
            </div>
          ))}
        </div>
      ))}
    </LoadingRegion>
  );
}

export function AppShellSkeleton(): React.ReactElement {
  return (
    <div className="pf-loading-shell" data-pf-shell-skeleton="true">
      <aside className="pf-loading-sidebar">
        <div className="flex h-11 items-center gap-2 px-3">
          <Skeleton className="size-7" />
          <Skeleton className="h-3 w-24" />
        </div>
        <div className="flex h-12 items-center gap-3 px-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="size-6" />
          ))}
        </div>
        <Skeleton className="mx-3 h-8" />
        <SidebarSkeleton />
      </aside>
      <div className="min-w-0 overflow-hidden">
        <div className="flex h-11 items-center gap-3 border-be px-3 md:hidden">
          <Skeleton className="size-6" />
          <Skeleton className="h-3 w-32" />
        </div>
        <RouteSkeleton />
      </div>
    </div>
  );
}
