import type { RalphMode, Task, TaskPriority, TaskStatus } from './Task.js';
import type { TaskAssignee } from './TaskAssignee.js';

export type TaskVersionField =
  | 'created'
  | 'description'
  | 'status'
  | 'assignee'
  | 'deadline'
  | 'priority'
  | 'ralphMode'
  | 'appearance'
  | 'parent'
  | 'project'
  | 'cancellation'
  | 'files'
  | 'customProperties'
  | 'commits';

// Снимок изменяемых полей задачи — то, что восстанавливает «Восстановить» (вся задача к версии).
export type TaskSnapshot = {
  readonly projectId: string;
  readonly description: string | null;
  readonly assignee: TaskAssignee;
  readonly icon: string | null;
  readonly cover: string | null;
  readonly coverPosition: number;
  readonly status: TaskStatus;
  readonly statusBeforeDone: TaskStatus | null;
  readonly ralphMode: RalphMode;
  readonly deadline: string | null;
  readonly startDate: string | null;
  readonly parentTaskId: string | null;
  readonly priority: TaskPriority | null;
  readonly ralphCancelRequestedAt: string | null;
  readonly ralphCancelRequestedBy: string | null;
};

export type TaskVersionActor = {
  readonly userId: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
};

// Версия задачи (одна запись истории).
export type TaskVersion = {
  readonly id: string;
  readonly taskId: string;
  readonly projectId: string;
  readonly actorUserId: string | null;
  readonly actor: TaskVersionActor | null;
  readonly changedFields: readonly TaskVersionField[];
  readonly snapshot: TaskSnapshot;
  readonly createdAt: Date;
};

// Снимок текущего состояния задачи.
export function snapshotOfTask(task: Task): TaskSnapshot {
  return {
    projectId: task.projectId,
    description: task.description,
    assignee: task.assignee,
    icon: task.icon,
    cover: task.cover,
    coverPosition: task.coverPosition,
    status: task.status,
    statusBeforeDone: task.statusBeforeDone,
    ralphMode: task.ralphMode,
    deadline: task.deadline,
    startDate: task.startDate,
    parentTaskId: task.parentTaskId,
    priority: task.priority,
    ralphCancelRequestedAt: task.ralphCancelRequestedAt?.toISOString() ?? null,
    ralphCancelRequestedBy: task.ralphCancelRequestedBy,
  };
}

export function changedTaskFields(
  previous: TaskSnapshot | null,
  current: TaskSnapshot,
): TaskVersionField[] {
  if (!previous) return ['created'];
  const fields: TaskVersionField[] = [];
  if (previous.projectId !== current.projectId) fields.push('project');
  if (previous.description !== current.description) fields.push('description');
  if (previous.assignee.userId !== current.assignee.userId) fields.push('assignee');
  if (
    previous.icon !== current.icon ||
    previous.cover !== current.cover ||
    previous.coverPosition !== current.coverPosition
  ) fields.push('appearance');
  if (
    previous.status !== current.status ||
    previous.statusBeforeDone !== current.statusBeforeDone
  ) fields.push('status');
  if (previous.ralphMode !== current.ralphMode) fields.push('ralphMode');
  if (previous.deadline !== current.deadline || previous.startDate !== current.startDate) {
    fields.push('deadline');
  }
  if (previous.parentTaskId !== current.parentTaskId) fields.push('parent');
  if (previous.priority !== current.priority) fields.push('priority');
  if (
    previous.ralphCancelRequestedAt !== current.ralphCancelRequestedAt ||
    previous.ralphCancelRequestedBy !== current.ralphCancelRequestedBy
  ) fields.push('cancellation');
  return fields;
}
