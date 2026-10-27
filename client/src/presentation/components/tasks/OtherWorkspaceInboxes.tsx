import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';
import type { AssignedTask } from '@/domain/task/AssignedTask';
import type { Workspace } from '@/domain/workspace/Workspace';
import { cn } from '@/lib/utils';
import { projectToneClass } from '@/lib/tone';
import { splitTitleBody } from '@/lib/taskTitleBody';
import { notificationTaskTarget } from '@/lib/notificationTaskTarget';
import { HttpError } from '@/lib/HttpError';
import { usePageRefresh } from '@/presentation/components/experience/usePageRefresh';
import { useWorkspaces } from '@/presentation/hooks/useWorkspaces';
import { useCurrentWorkspace } from '@/presentation/hooks/useCurrentWorkspace';
import { useSwitchWorkspace } from '@/presentation/hooks/useSwitchWorkspace';
import { WorkspaceIcon } from '@/presentation/layout/WorkspaceIcon';
import { DeadlineBadge } from './DeadlineBadge';
import { TaskTitleText } from './TaskTitleText';
import { workspaceInboxPreview, type WorkspaceInboxPreview } from './workspaceInboxPreview';

type Loaded = readonly AssignedTask[] | 'error';

const SWITCH_ERROR = 'Не удалось переключить пространство. Попробуйте ещё раз.';

// «Все входящие»: под полными входящими текущего пространства — по компактному блоку на
// каждое другое пространство пользователя, сверху вниз. Только чтение: мои открытые задачи
// там (несколько самых срочных + «ещё N»). Тап по задаче переключает пространство и
// открывает её, «Открыть» — входящие того пространства. Пространства без открытых задач не
// показываем: пустые блоки только шумят.
export function OtherWorkspaceInboxes(): React.ReactElement | null {
  const { taskAssigneeRepository } = useContainer();
  const { data: workspaces } = useWorkspaces();
  const { workspace: current } = useCurrentWorkspace();
  const { switchTo } = useSwitchWorkspace();
  const navigate = useNavigate();
  const others = useMemo(
    () => (workspaces ?? []).filter((w) => w.id !== current?.id),
    [workspaces, current?.id],
  );
  const [loaded, setLoaded] = useState<Readonly<Record<string, Loaded>>>({});
  const seq = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const run = ++seq.current;
    const entries = await Promise.all(
      others.map(async (w): Promise<[string, Loaded | null]> => {
        try {
          return [w.id, await taskAssigneeRepository.listMineInWorkspace(w.id)];
        } catch (error) {
          // 404: membership ended since the workspace list was loaded — the block just goes.
          return [w.id, error instanceof HttpError && error.status === 404 ? null : 'error'];
        }
      }),
    );
    if (run !== seq.current) return;
    const next: Record<string, Loaded> = {};
    for (const [id, value] of entries) if (value !== null) next[id] = value;
    setLoaded(next);
  }, [others, taskAssigneeRepository]);

  useEffect(() => {
    void load();
    return () => {
      seq.current += 1;
    };
  }, [load]);
  usePageRefresh(load, others.length > 0);

  const switchAnd = (workspace: Workspace, to?: string): void => {
    void (async () => {
      try {
        await switchTo(workspace.id);
      } catch {
        toast.error(SWITCH_ERROR);
        return;
      }
      if (to) navigate(to);
    })();
  };

  // preview null = loading failed (a retry line instead of the list).
  type Block = { workspace: Workspace; preview: WorkspaceInboxPreview | null };
  const blocks = others.flatMap((workspace): Block[] => {
    const state = loaded[workspace.id];
    if (state === undefined) return [];
    if (state === 'error') return [{ workspace, preview: null }];
    const preview = workspaceInboxPreview(state);
    return preview.total > 0 ? [{ workspace, preview }] : [];
  });
  if (blocks.length === 0) return null;

  // Phone: keep room for the floating composer below the last block, like the main block.
  return (
    <div className="flex flex-col gap-6 max-md:pbe-20" data-pf-other-workspace-inboxes>
      {blocks.map(({ workspace, preview }) => {
        const headingId = `workspace-inbox-${workspace.id}`;
        return (
          <section
            key={workspace.id}
            aria-labelledby={headingId}
            data-pf-workspace-inbox={workspace.id}
            className="flex min-w-0 flex-col gap-2 border-bs pbs-4"
          >
            <div className="flex min-h-11 min-w-0 items-center gap-2">
              <WorkspaceIcon name={workspace.name} icon={workspace.icon} className="size-6" />
              <h2 id={headingId} className="min-w-0 truncate text-base font-semibold">
                {workspace.name}
              </h2>
              {preview && (
                <span
                  className="shrink-0 text-meta tabular-nums text-muted-foreground"
                  aria-label={`Открытых задач: ${preview.total}`}
                >
                  {preview.total}
                </span>
              )}
              <span className="flex-1" />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-11 shrink-0 gap-1.5 px-2.5 text-muted-foreground hover:text-foreground md:h-8"
                aria-label={`Открыть входящие пространства «${workspace.name}»`}
                onClick={() => switchAnd(workspace)}
              >
                Открыть
                <ArrowRight className="size-4" />
              </Button>
            </div>

            {preview ? (
              <ul className="flex min-w-0 flex-col overflow-clip rounded-lg border">
                {preview.items.map((task) => (
                  <li key={task.id} className="min-w-0 border-bs first:border-bs-0">
                    <WorkspaceTaskRow
                      task={task}
                      onOpen={() =>
                        switchAnd(workspace, notificationTaskTarget({ projectId: task.projectId, taskId: task.id }) ?? undefined)
                      }
                    />
                  </li>
                ))}
                {preview.total > preview.items.length && (
                  <li className="border-bs">
                    <button
                      type="button"
                      onClick={() => switchAnd(workspace)}
                      className="flex min-h-11 w-full items-center px-3 text-start text-ui text-muted-foreground transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:min-h-9"
                    >
                      ещё {preview.total - preview.items.length}
                    </button>
                  </li>
                )}
              </ul>
            ) : (
              <p className="text-ui text-muted-foreground">
                Не удалось загрузить задачи этого пространства.{' '}
                <button
                  type="button"
                  onClick={() => void load()}
                  className="text-primary-ink underline-offset-2 hover:underline"
                >
                  Повторить
                </button>
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}

function WorkspaceTaskRow({
  task,
  onOpen,
}: {
  task: AssignedTask;
  onOpen: () => void;
}): React.ReactElement {
  const { title } = splitTitleBody(task.description ?? '');
  const projectLabel = task.isInbox ? 'Личные' : task.projectName;
  return (
    <button
      type="button"
      data-pf-other-task-id={task.id}
      onClick={onOpen}
      className="flex min-h-11 w-full min-w-0 flex-col gap-1 px-3 py-2 text-start transition-colors hover:bg-hover active:bg-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <TaskTitleText
        title={title || 'Задача'}
        className="line-clamp-2 min-w-0 break-words text-task"
        authoredBold
      />
      <span className="flex min-w-0 items-center gap-2 text-meta">
        <span className={cn('pf-tag min-w-0', projectToneClass(task.projectId, task.isInbox))} title={projectLabel}>
          <span className="truncate">{projectLabel}</span>
        </span>
        {task.deadline && (
          <DeadlineBadge deadline={task.deadline} status={task.status} className="ms-auto shrink-0" />
        )}
      </span>
    </button>
  );
}
