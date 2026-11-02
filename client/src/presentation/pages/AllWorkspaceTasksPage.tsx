import { Eye, EyeOff, Globe } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import { WorkspaceContainerProvider } from '@/infrastructure/di/container';
import { PageTitle, PageTopBar } from '@/presentation/layout/PageChrome';
import { WorkspaceIcon } from '@/presentation/layout/WorkspaceIcon';
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
  const persistHidden = (next: string[]): void => {
    setVisibility({ key: storageKey, hidden: next });
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Keep the setting for this visit when storage is unavailable.
    }
  };
  const setWorkspaceVisible = (id: string, visible: boolean): void => {
    const next = visible ? hidden.filter((item) => item !== id) : [...new Set([...hidden, id])];
    persistHidden(next);
  };
  const showAllWorkspaces = (): void => {
    persistHidden([]);
  };
  if (!workspaces) return <PageSkeleton layout="inbox" />;
  const visibleWorkspaces = workspaces.filter((workspace) => !hidden.includes(workspace.id));
  return (
    <div className="flex min-h-full flex-col">
      <PageTopBar className="hidden sm:flex">
        <span className="flex items-center gap-2 text-ui"><Globe className="size-4" /> Все пространства</span>
      </PageTopBar>
      <div className="flex flex-1 flex-col gap-6 px-4 pbe-6 pbs-3 sm:px-6 sm:pbs-4 lg:px-9">
        <div className="space-y-3">
          <div className="space-y-1">
            <PageTitle>Все задачи</PageTitle>
            <p className="text-sm text-muted-foreground">Мои задачи из всех пространств. Общие задачи и задачи коллег — во вкладке «Все».</p>
          </div>
          {workspaces.length > 0 && (
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Видимость пространств">
              <span className="me-1 text-xs font-medium text-muted-foreground">
                Пространства ({visibleWorkspaces.length} из {workspaces.length}):
              </span>
              {workspaces.map((workspace) => {
                const isVisible = !hidden.includes(workspace.id);
                return (
                  <label
                    key={workspace.id}
                    className={cn(
                      'inline-flex cursor-pointer select-none items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                      isVisible
                        ? 'border-border bg-card text-foreground hover:bg-hover'
                        : 'border-dashed border-border/70 text-muted-foreground opacity-75 hover:border-border hover:text-foreground hover:opacity-100',
                    )}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={isVisible}
                      onChange={(event) => setWorkspaceVisible(workspace.id, event.target.checked)}
                    />
                    <WorkspaceIcon name={workspace.name} icon={workspace.icon} className="size-4 rounded-[4px]" iconPx={12} />
                    <span>{workspace.name}</span>
                    {isVisible ? <Eye className="size-3.5 text-muted-foreground" /> : <EyeOff className="size-3.5" />}
                  </label>
                );
              })}
              {hidden.length > 0 && (
                <button
                  type="button"
                  onClick={showAllWorkspaces}
                  className="ms-1 cursor-pointer rounded-md px-2 py-1 text-xs font-medium text-muted-foreground underline-offset-4 transition-colors hover:bg-hover hover:text-foreground hover:underline"
                >
                  Показать все
                </button>
              )}
            </div>
          )}
        </div>
        {error && <p role="alert" className="text-sm text-destructive">Не удалось обновить список пространств.</p>}
        {workspaces.length === 0 && <p className="text-sm text-muted-foreground">Нет доступных пространств.</p>}
        {workspaces.length > 0 && visibleWorkspaces.length === 0 && (
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <p>Все пространства скрыты. Включите нужные в панели выше.</p>
            <button
              type="button"
              onClick={showAllWorkspaces}
              className="cursor-pointer rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-hover"
            >
              Показать все пространства
            </button>
          </div>
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
                          <AddTaskDialogProvider>
                            <InboxPage embedded onHideWorkspace={() => setWorkspaceVisible(workspace.id, false)} />
                          </AddTaskDialogProvider>
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
