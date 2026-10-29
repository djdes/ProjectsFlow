import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Globe, Search } from 'lucide-react';
import type { WorkspaceTasksResult } from '@/application/task/ListWorkspaceTasks';
import { useContainer } from '@/infrastructure/di/container';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageTitle, PageTopBar } from '@/presentation/layout/PageChrome';
import { WorkspaceIcon } from '@/presentation/layout/WorkspaceIcon';
import { useWorkspaces } from '@/presentation/hooks/useWorkspaces';
import { usePageRefresh } from '@/presentation/components/experience/usePageRefresh';
import { useInboxRealtimeRefresh } from '@/presentation/hooks/useInboxRealtimeRefresh';
import { PageSkeleton } from '@/presentation/components/loading/LoadingLayouts';
import { DeadlineBadge } from '@/presentation/components/tasks/DeadlineBadge';
import { TaskTitleText } from '@/presentation/components/tasks/TaskTitleText';
import { STATUS_LABEL } from '@/presentation/components/tasks/statusLabels';
import { plainTaskTitle } from '@/lib/taskTitleBody';
import { cn } from '@/lib/utils';
import { projectToneClass } from '@/lib/tone';
import { notificationTaskTarget } from '@/lib/notificationTaskTarget';

export function AllWorkspaceTasksPage(): React.ReactElement {
  const { listWorkspaceTasks } = useContainer();
  const { data: workspaces, error: workspaceError } = useWorkspaces();
  const [results, setResults] = useState<readonly WorkspaceTasksResult[] | null>(null);
  const [query, setQuery] = useState('');
  const sequence = useRef(0);
  const lastRefreshAt = useRef(0);
  const load = useCallback(async (): Promise<void> => {
    const run = ++sequence.current;
    const next = await listWorkspaceTasks.execute((workspaces ?? []).map((workspace) => workspace.id));
    if (run === sequence.current) {
      setResults(next);
      lastRefreshAt.current = Date.now();
    }
  }, [listWorkspaceTasks, workspaces]);
  const cancelLoads = useCallback(() => { sequence.current++; }, []);
  useEffect(() => {
    setResults(null);
    void load();
    return cancelLoads;
  }, [load, cancelLoads]);
  usePageRefresh(load);
  useInboxRealtimeRefresh(load, lastRefreshAt);

  if (!workspaces || !results) return <PageSkeleton layout="inbox" />;
  const search = query.trim().toLocaleLowerCase('ru');
  return (
    <div className="flex min-h-full flex-col">
      <PageTopBar className="hidden sm:flex">
        <span className="flex items-center gap-2 text-ui"><Globe className="size-4" /> Все пространства</span>
      </PageTopBar>
      <div className="flex flex-1 flex-col gap-6 px-4 pbe-6 pbs-3 sm:px-6 sm:pbs-4 lg:px-9">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <PageTitle>Все задачи</PageTitle>
            <p className="text-sm text-muted-foreground">Все доступные задачи по пространствам и проектам.</p>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute start-3 inset-bs-3 size-4 text-muted-foreground" />
            <Input aria-label="Поиск во всех задачах" placeholder="Задача, проект или ответственный" className="ps-9"
              value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
        </div>
        {workspaceError && <p role="alert" className="text-sm text-destructive">Не удалось обновить список пространств.</p>}
        {workspaces.length === 0 && <p className="text-sm text-muted-foreground">Нет доступных пространств.</p>}
        {workspaces.map((workspace) => {
          const result = results.find((item) => item.workspaceId === workspace.id);
          const groups = result?.status === 'ready' ? result.groups.map((group) => ({ ...group,
            tasks: group.tasks.filter((task) => !search ||
              [workspace.name, group.projectName, task.description, task.assignee.displayName, STATUS_LABEL[task.status]]
                .join(' ').toLocaleLowerCase('ru').includes(search)),
          })).filter((group) => group.tasks.length > 0) : [];
          const total = groups.reduce((sum, group) => sum + group.tasks.length, 0);
          return (
            <section key={workspace.id} aria-labelledby={`all-tasks-${workspace.id}`} data-pf-workspace-tasks={workspace.id}
              className="min-w-0 space-y-3 border-bs pbs-4">
              <div className="flex items-center gap-2">
                <WorkspaceIcon name={workspace.name} icon={workspace.icon} className="size-6" />
                <h2 id={`all-tasks-${workspace.id}`} className="min-w-0 break-words text-base font-semibold">{workspace.name}</h2>
                {result?.status === 'ready' && <span className="text-meta tabular-nums text-muted-foreground">{total}</span>}
              </div>
              {result?.status === 'error' ? <div role="alert" className="flex flex-wrap items-center gap-2 text-sm">
                <span>Не удалось загрузить задачи этого пространства.</span>
                <Button variant="outline" size="sm" onClick={() => void load()}>Повторить</Button>
              </div> : groups.length === 0 ? <p className="text-sm text-muted-foreground">{search ? 'Задачи не найдены.' : 'Задач пока нет.'}</p> :
                groups.map((group) => (
                  <div key={group.projectId} className="min-w-0 space-y-2" data-pf-task-project={group.projectId}>
                    <h3 className="flex min-w-0 items-center gap-2 text-sm font-medium">
                      <span className={cn('pf-tag min-w-0', projectToneClass(group.projectId))}><span className="truncate">{group.projectName}</span></span>
                      <span className="text-meta tabular-nums text-muted-foreground">{group.tasks.length}</span>
                    </h3>
                    <ul className="min-w-0 rounded-lg border">
                      {group.tasks.map((task) => (
                        <li key={task.id} className="border-bs first:border-bs-0">
                          <Link to={notificationTaskTarget({ projectId: task.projectId, taskId: task.id })!}
                            data-pf-global-task-id={task.id}
                            className="flex min-h-11 min-w-0 flex-col gap-1.5 px-3 py-2.5 transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                            <TaskTitleText title={plainTaskTitle(task.description ?? '') || 'Задача'} className="min-w-0 break-words text-task" authoredBold />
                            <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-muted-foreground">
                              <span>{STATUS_LABEL[task.status]}</span>
                              <span>{task.assignee.displayName}</span>
                              {task.deadline && <DeadlineBadge deadline={task.deadline} status={task.status} />}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}
