import { Globe } from 'lucide-react';
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

// The actual workspace board, with independent request scope and local state per space.
export function AllWorkspaceTasksPage(): React.ReactElement {
  const { data: workspaces, error } = useWorkspaces();
  if (!workspaces) return <PageSkeleton layout="inbox" />;
  return (
    <div className="flex min-h-full flex-col">
      <PageTopBar className="hidden sm:flex">
        <span className="flex items-center gap-2 text-ui"><Globe className="size-4" /> Все пространства</span>
      </PageTopBar>
      <div className="flex flex-1 flex-col gap-6 px-4 pbe-6 pbs-3 sm:px-6 sm:pbs-4 lg:px-9">
        <div className="space-y-1">
          <PageTitle>Все задачи</PageTitle>
          <p className="text-sm text-muted-foreground">Мои задачи из всех пространств. Задачи коллег — во вкладке «Другим».</p>
        </div>
        {error && <p role="alert" className="text-sm text-destructive">Не удалось обновить список пространств.</p>}
        {workspaces.length === 0 && <p className="text-sm text-muted-foreground">Нет доступных пространств.</p>}
        {workspaces.map((workspace) => (
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
