import { Globe } from 'lucide-react';
import { useState } from 'react';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import { WorkspaceContainerProvider } from '@/infrastructure/di/container';
import { PageTitle, PageTopBar } from '@/presentation/layout/PageChrome';
import { useWorkspaces } from '@/presentation/hooks/useWorkspaces';
import { WorkspaceViewProvider } from '@/presentation/hooks/WorkspacesProvider';
import { ProjectsProvider } from '@/presentation/hooks/ProjectsProvider';
import { FocusedInboxProvider } from '@/presentation/hooks/FocusedInboxProvider';
import { CompletedTodayProvider } from '@/presentation/hooks/CompletedTodayProvider';
import { UnreadTasksProvider } from '@/presentation/hooks/UnreadTasksProvider';
import { AwaitingReplyProvider } from '@/presentation/hooks/AwaitingReplyProvider';
import { AddTaskDialogProvider } from '@/presentation/components/forms/AddTaskDialogProvider';
import { PageSkeleton } from '@/presentation/components/loading/LoadingLayouts';
import { InboxPage } from './InboxPage';

function readHiddenWorkspaces(key: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

// The actual workspace board, with independent request scope and local state per space.
export function AllWorkspaceTasksPage(): React.ReactElement {
  const { data: workspaces, error } = useWorkspaces();
  const { user } = useCurrentUser();
  const storageKey = `pf:all-tasks:hidden-workspaces:${user?.id ?? ''}`;
  const [visibility, setVisibility] = useState(() => ({ key: storageKey, hidden: readHiddenWorkspaces(storageKey) }));
  if (visibility.key !== storageKey) {
    setVisibility({ key: storageKey, hidden: readHiddenWorkspaces(storageKey) });
  }
  const hidden = visibility.key === storageKey ? visibility.hidden : readHiddenWorkspaces(storageKey);
  const setWorkspaceVisible = (id: string, visible: boolean): void => {
    const next = visible ? hidden.filter((item) => item !== id) : [...new Set([...hidden, id])];
    setVisibility({ key: storageKey, hidden: next });
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Keep the setting for this visit when storage is unavailable.
    }
  };
  if (!workspaces) return <PageSkeleton layout="inbox" />;
  const visibleWorkspaces = workspaces.filter((workspace) => !hidden.includes(workspace.id));
  return (
    <div className="flex min-h-full flex-col">
      <PageTopBar className="hidden sm:flex">
        <span className="flex items-center gap-2 text-ui"><Globe className="size-4" /> Все пространства</span>
      </PageTopBar>
      <div className="flex flex-1 flex-col gap-6 px-4 pbe-6 pbs-3 sm:px-6 sm:pbs-4 lg:px-9">
        <div className="space-y-1">
          <PageTitle>Все задачи</PageTitle>
          <p className="text-sm text-muted-foreground">Мои задачи из всех пространств. Общие задачи и задачи коллег — во вкладке «Все».</p>
        </div>
        {workspaces.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">Пространства ({visibleWorkspaces.length} из {workspaces.length})</summary>
            <div className="flex flex-wrap gap-3 pbs-2">
              {workspaces.map((workspace) => (
                <label key={workspace.id} className="flex cursor-pointer items-center gap-2">
                  <input type="checkbox" checked={!hidden.includes(workspace.id)}
                    onChange={(event) => setWorkspaceVisible(workspace.id, event.target.checked)} />
                  {workspace.name}
                </label>
              ))}
            </div>
          </details>
        )}
        {error && <p role="alert" className="text-sm text-destructive">Не удалось обновить список пространств.</p>}
        {workspaces.length === 0 && <p className="text-sm text-muted-foreground">Нет доступных пространств.</p>}
        {workspaces.length > 0 && visibleWorkspaces.length === 0 && (
          <p className="text-sm text-muted-foreground">Все пространства скрыты. Выберите нужные в меню «Пространства» выше.</p>
        )}
        {visibleWorkspaces.map((workspace) => (
          <section key={workspace.id} aria-label={`Задачи пространства «${workspace.name}»`} data-pf-workspace-tasks={workspace.id}
            className="min-w-0 border-bs pbs-4">
            <WorkspaceContainerProvider workspaceId={workspace.id}>
              <WorkspaceViewProvider workspaceId={workspace.id}>
                <ProjectsProvider>
                  <FocusedInboxProvider>
                    <CompletedTodayProvider>
                      <UnreadTasksProvider>
                        <AwaitingReplyProvider>
                          <AddTaskDialogProvider><InboxPage embedded /></AddTaskDialogProvider>
                        </AwaitingReplyProvider>
                      </UnreadTasksProvider>
                    </CompletedTodayProvider>
                  </FocusedInboxProvider>
                </ProjectsProvider>
              </WorkspaceViewProvider>
            </WorkspaceContainerProvider>
          </section>
        ))}
      </div>
    </div>
  );
}
