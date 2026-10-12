import { useNotificationStream } from '@/presentation/hooks/useNotificationStream';
import { Fragment, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useWorkspacesContext } from '@/presentation/hooks/WorkspacesProvider';
import { PageSkeleton } from '@/presentation/components/loading/LoadingLayouts';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { loadingLayoutForPath } from '@/lib/loadingLayout';

// All caches, dialogs, selections, counts and event subscriptions below this boundary
// belong to one workspace. Remove the old tree before the preference write starts.
export function WorkspaceBoundary({ children }: { children: ReactNode }): React.ReactElement {
  const { current, loading, switching, error, refresh } = useWorkspacesContext();
  const { pathname } = useLocation();
  if (!loading && !switching && error && !current) {
    return <div className="grid h-dvh place-items-center p-6">
      <div className="space-y-4 text-center"><p>Не удалось загрузить пространство</p>
        <Button onClick={refresh}>Повторить</Button></div>
    </div>;
  }
  if (loading || switching || !current) {
    return <div data-pf-workspace-loading role="status" aria-label="Загружаем пространство…"
      className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      <div className="flex min-h-12 shrink-0 items-center gap-3 border-be px-4 md:hidden">
        <Skeleton className="size-6" /><Skeleton className="h-4 w-36" />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden"><PageSkeleton layout={loadingLayoutForPath(pathname)} /></div>
      <div className="flex shrink-0 gap-3 border-bs px-4 pbs-2 pbe-[calc(.75rem_+_env(safe-area-inset-bottom,0px))] md:hidden">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 flex-1 rounded-lg" />)}
      </div>
    </div>;
  }
  return <Fragment key={current.id}>{children}</Fragment>;
}

export function WorkspaceNotifications(): null {
  const { current } = useWorkspacesContext();
  useNotificationStream(current!.id);
  return null;
}
