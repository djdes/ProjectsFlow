import type { RalphMode, TaskPriority, TaskStatus } from './Task';
import type { PlanId } from '@/domain/usage/Usage';

// Снимок изменяемых полей задачи (зеркало server/domain/task/TaskVersion).
export type TaskSnapshot = {
  readonly description: string | null;
  readonly status: TaskStatus;
  readonly statusBeforeDone: TaskStatus | null;
  readonly ralphMode: RalphMode;
  readonly deadline: string | null;
  readonly priority: TaskPriority | null;
};

export type TaskVersion = {
  readonly id: string;
  readonly taskId: string;
  readonly actorUserId: string | null;
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
