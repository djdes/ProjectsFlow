import type { AssignedTask } from './AssignedTask';

export type WorkspaceTaskGroup = {
  readonly projectId: string;
  readonly projectName: string;
  readonly tasks: readonly AssignedTask[];
};

// Identity is the task/project id: equally named projects in different spaces stay distinct.
// Include every status and every assignee; this overview has no preview limit.
export function groupWorkspaceTasks(tasks: readonly AssignedTask[]): WorkspaceTaskGroup[] {
  const groups = new Map<string, { projectId: string; projectName: string; tasks: AssignedTask[] }>();
  const seen = new Set<string>();
  for (const task of tasks) {
    if (seen.has(task.id)) continue;
    seen.add(task.id);
    const group = groups.get(task.projectId) ?? {
      projectId: task.projectId,
      projectName: task.isInbox ? `Личные${task.inboxOwner?.displayName ? ` · ${task.inboxOwner.displayName}` : ''}` : task.projectName,
      tasks: [],
    };
    group.tasks.push(task);
    groups.set(task.projectId, group);
  }
  return [...groups.values()].sort((a, b) => a.projectName.localeCompare(b.projectName, 'ru'))
    .map((group) => ({ ...group, tasks: [...group.tasks].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()) }));
}
