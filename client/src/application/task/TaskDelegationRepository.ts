import type { TaskDelegation } from '@/domain/task/TaskDelegation';
import type { AssignedGroup } from '@/domain/task/AssignedTask';

// Pending делегация + excerpt описания задачи — то, что приходит из
// /api/delegations/pending для верхнего блока inbox.
export type PendingDelegation = TaskDelegation & {
  readonly taskExcerpt: string;
};

export interface TaskDelegationRepository {
  // pending для меня как делегата (UI блок «Делегировано мне»).
  listMyPending(): Promise<PendingDelegation[]>;
  // Все поручённые мне задачи (pending+accepted) по всем проектам, сгруппированные
  // по проекту — для блока «Поручено мне» на главной.
  listAssignedToMe(): Promise<AssignedGroup[]>;
  accept(id: string): Promise<TaskDelegation>;
  decline(id: string): Promise<TaskDelegation>;
  // creator отзывает pending до accept'а.
  withdraw(id: string): Promise<void>;
}
