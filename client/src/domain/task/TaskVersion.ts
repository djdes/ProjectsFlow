import type { RalphMode, TaskPriority, TaskStatus } from './Task';
import type { PlanId } from '@/domain/usage/Usage';
import type { TaskAssignee } from './TaskAssignee';

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

// Снимок изменяемых полей задачи (зеркало server/domain/task/TaskVersion).
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

export type TaskVersion = {
  readonly id: string;
  readonly taskId: string;
  readonly actorUserId: string | null;
  readonly actor: TaskVersionActor | null;
  readonly changedFields: readonly TaskVersionField[];
  readonly createdAt: Date;
  readonly snapshot: TaskSnapshot;
};

// Список версий + текущий тариф + граница доступности (версии старше cutoffAt на free
// заблокированы — нужен Прайм/ВИП).
export type TaskVersionsResult = {
  readonly versions: readonly TaskVersion[];
  readonly plan: PlanId;
  readonly cutoffAt: Date | null;
};
