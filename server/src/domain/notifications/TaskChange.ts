import type { Task } from '../task/Task.js';
import type { TaskVersionField } from '../task/TaskVersion.js';

export type TaskChange = {
  readonly task: Task;
  readonly previous: Task | null;
  readonly actorUserId: string | null;
  readonly changedFields: readonly TaskVersionField[];
};

// Business audience, independent of transport. Access is checked by the application.
export function taskChangeRecipients(input: {
  actorUserId: string | null;
  assigneeUserId: string;
  previousAssigneeUserId?: string;
  approverUserIds: readonly string[];
}): string[] {
  return [...new Set([
    input.assigneeUserId,
    ...input.approverUserIds,
    ...(input.previousAssigneeUserId ? [input.previousAssigneeUserId] : []),
  ])].filter((id) => id !== input.actorUserId);
}

export type TaskChangeAction =
  | 'created' | 'updated' | 'approval_requested' | 'approved' | 'completed'
  | 'returned' | 'withdrawn' | 'reopened' | 'status_changed' | 'assigned'
  | 'moved' | 'deleted' | 'restored';

export function taskChangeAction(change: TaskChange): TaskChangeAction {
  const { task, previous, changedFields: fields } = change;
  if (fields.includes('deleted')) return 'deleted';
  if (fields.includes('restored')) return 'restored';
  if (!previous || fields.includes('created')) {
    return task.status === 'pending_approval' ? 'approval_requested' : 'created';
  }
  if (previous.projectId !== task.projectId) return 'moved';
  if (previous.assignee.userId !== task.assignee.userId) return 'assigned';
  if (previous.status !== task.status) {
    if (task.status === 'pending_approval') return 'approval_requested';
    if (task.status === 'done') return previous.status === 'pending_approval' ? 'approved' : 'completed';
    if (previous.status === 'pending_approval') {
      return change.actorUserId === task.assignee.userId ? 'withdrawn' : 'returned';
    }
    if (previous.status === 'done') return 'reopened';
    return 'status_changed';
  }
  return 'updated';
}
