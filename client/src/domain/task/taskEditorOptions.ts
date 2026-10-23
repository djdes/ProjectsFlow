import { kanbanColumnOrder, type KanbanBoardSettings } from '../kanban/KanbanSettings';
import type { Project } from '../project/Project';
import type { Task, TaskStatus } from './Task';

export function taskStatusOptions(
  settings: KanbanBoardSettings | null,
  workerEnabled: boolean,
  approvalEnabled: boolean,
  current: TaskStatus,
): TaskStatus[] {
  const statuses: TaskStatus[] = kanbanColumnOrder(settings).filter(
    (status) => !settings?.[status]?.hidden && (workerEnabled || status !== 'todo'),
  );
  if (approvalEnabled) {
    const doneIndex = statuses.indexOf('done');
    statuses.splice(doneIndex < 0 ? statuses.length : doneIndex, 0, 'pending_approval');
  }
  if (!statuses.includes(current)) statuses.unshift(current);
  return statuses;
}

export function canTransferProject(project: Project, userId: string): boolean {
  return project.isInbox
    ? project.ownerId === userId
    : project.role === 'owner' || project.role === 'lead' || project.role === 'editor';
}

export function taskProjectOptions(projects: readonly Project[], userId: string): Project[] {
  return projects.filter((p) => p.status !== 'archived' && canTransferProject(p, userId));
}

// The task page already passed the read gate. Match task-scoped editing rights.
export function canEditReadableTask(project: Project | null, task: Task, userId: string | null): boolean {
  if (!project || !userId) return false;
  if (task.assignee.userId === userId) return true;
  if (project.isInbox) return project.ownerId === userId;
  return project.role === 'owner' || project.role === 'lead';
}
