import type { TaskDelegation } from '@/domain/task/TaskDelegation';

// Pending делегация + excerpt описания задачи — то, что приходит из
// /api/delegations/pending для верхнего блока inbox.
export type PendingDelegation = TaskDelegation & {
  readonly taskExcerpt: string;
};

export interface TaskDelegationRepository {
  // pending для меня как делегата (UI блок «Делегировано мне»).
  listMyPending(): Promise<PendingDelegation[]>;
  accept(id: string): Promise<TaskDelegation>;
  decline(id: string): Promise<TaskDelegation>;
  // creator отзывает pending до accept'а.
  withdraw(id: string): Promise<void>;
}
