import type { Project } from '@/domain/project/Project';
import type { Task } from '@/domain/task/Task';

// Чистая часть useTaskOriginLabel: происхождение NULL и неизвестное пространство — основное
// (первое в sharedWorkspaces); своё пространство подписи не получает.
export function taskOriginLabel(
  project: Pick<Project, 'sharedWorkspaces'> | null,
  currentWorkspaceId: string | null,
  task: Pick<Task, 'originWorkspaceId'>,
): string | null {
  const shared = project?.sharedWorkspaces ?? [];
  if (shared.length < 2) return null;
  const origin = shared.find((w) => w.id === task.originWorkspaceId) ?? shared[0]!;
  return origin.id === currentWorkspaceId ? null : origin.name;
}
