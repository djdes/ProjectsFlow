import type { Project } from '@/domain/project/Project';
import type { Workspace } from '@/domain/workspace/Workspace';
import { useWorkspacesContext } from './WorkspacesProvider';

// Пространство, которому принадлежит проект. Активное пространство тут не годится: личный хаб
// показывает проекты всех пространств, и приглашение «в пространство проекта» ушло бы не туда.
// Нет workspaceId (старый ответ сервера) или пространство не найдено — откат на активное.
export function useProjectWorkspace(project: Pick<Project, 'workspaceId'>): Workspace | null {
  const { data, current } = useWorkspacesContext();
  const own = project.workspaceId ? data?.find((ws) => ws.id === project.workspaceId) : undefined;
  return own ?? current;
}
