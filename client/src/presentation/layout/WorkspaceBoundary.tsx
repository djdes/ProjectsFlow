import { useNotificationStream } from '@/presentation/hooks/useNotificationStream';
import { Fragment, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWorkspacesContext } from '@/presentation/hooks/WorkspacesProvider';
import { AppShellSkeleton } from '@/presentation/components/loading/LoadingLayouts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCreateWorkspace } from '@/presentation/hooks/useCreateWorkspace';

// All caches, dialogs, selections, counts and event subscriptions below this boundary
// belong to one workspace. Remove the old tree before the preference write starts.
export function WorkspaceBoundary({ children }: { children: ReactNode }): React.ReactElement {
  const { data, current, loading, switching, error, refresh } = useWorkspacesContext();
  if (!loading && !switching && error && !current) {
    return <div className="grid h-dvh place-items-center p-6">
      <div className="space-y-4 text-center"><p>Не удалось загрузить пространство</p>
        <Button onClick={refresh}>Повторить</Button></div>
    </div>;
  }
  // Ни одного пространства (аккаунт из scripts/seed-admin.mjs, а не из регистрации):
  // без этого экрана оболочка вечно показывала скелетон — ждать было нечего.
  if (!loading && !switching && !error && data !== null && data.length === 0) {
    return <NoWorkspaceScreen />;
  }
  if (loading || switching || !current) {
    // The same shell skeleton as the boot screen and the sign-in check: no layout switch.
    return <div data-pf-workspace-loading role="status" aria-label="Загружаем пространство…">
      <AppShellSkeleton />
    </div>;
  }
  return <Fragment key={current.id}>{children}</Fragment>;
}

function NoWorkspaceScreen(): React.ReactElement {
  const { submit, saving, error } = useCreateWorkspace();
  const [name, setName] = useState('Моё пространство');
  const onSubmit = (e: FormEvent): void => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    void submit(trimmed, null).catch(() => undefined);
  };
  return (
    <div className="grid min-h-dvh place-items-center p-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4 rounded-xl border bg-card p-6">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">Создайте пространство</h1>
          <p className="text-sm text-muted-foreground">
            У аккаунта пока нет ни одного пространства. В нём будут проекты, задачи и чат команды.
          </p>
        </div>
        <Input
          aria-label="Название пространства"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        {error && <p className="text-sm text-destructive">{error.message}</p>}
        <Button type="submit" className="w-full" disabled={saving || !name.trim()}>
          {saving ? 'Создаём…' : 'Создать пространство'}
        </Button>
      </form>
    </div>
  );
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
