import type { Task } from '@/domain/task/Task';
import { useOptionalProjectsContext } from './ProjectsProvider';
import { useOptionalWorkspacesContext } from './WorkspacesProvider';
import { taskOriginLabel } from './taskOriginLabel';

// Подпись «из какого пространства» для задачи общего проекта (db/182), если она создана не в
// текущем пространстве. null — проект не общий или задача своя.
export function useTaskOriginLabel(task: Pick<Task, 'projectId' | 'originWorkspaceId'>): string | null {
  const projects = useOptionalProjectsContext();
  const workspaces = useOptionalWorkspacesContext();
  const project = projects?.data?.find((p) => p.id === task.projectId) ?? null;
  return taskOriginLabel(project, workspaces?.current?.id ?? null, task);
}
