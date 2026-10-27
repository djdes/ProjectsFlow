import { useNotificationStream } from '@/presentation/hooks/useNotificationStream';
import { Fragment, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWorkspacesContext } from '@/presentation/hooks/WorkspacesProvider';
import { AppShellSkeleton } from '@/presentation/components/loading/LoadingLayouts';
import { Button } from '@/components/ui/button';

// All caches, dialogs, selections, counts and event subscriptions below this boundary
// belong to one workspace. Remove the old tree before the preference write starts.
export function WorkspaceBoundary({ children }: { children: ReactNode }): React.ReactElement {
  const { current, loading, switching, error, refresh } = useWorkspacesContext();
  if (!loading && !switching && error && !current) {
    return <div className="grid h-dvh place-items-center p-6">
      <div className="space-y-4 text-center"><p>Не удалось загрузить пространство</p>
        <Button onClick={refresh}>Повторить</Button></div>
    </div>;
  }
  if (loading || switching || !current) {
    // The same shell skeleton as the boot screen and the sign-in check: no layout switch.
    return <div data-pf-workspace-loading role="status" aria-label="Загружаем пространство…">
      <AppShellSkeleton />
    </div>;
  }
  return <Fragment key={current.id}>{children}</Fragment>;
}

export function WorkspaceNotifications(): null {
  const { current, switchTo } = useWorkspacesContext();
  const navigate = useNavigate();
  useNotificationStream(current!.id, async (to, workspaceId) => {
    if (workspaceId && workspaceId !== current!.id) await switchTo(workspaceId);
    navigate(to);
  });
  return null;
}
