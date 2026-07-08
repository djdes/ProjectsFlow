import type { TaskDelegation } from '@/domain/task/TaskDelegation';
import type { AssignedTask } from '@/domain/task/AssignedTask';

// Pending делегация + excerpt описания задачи — то, что приходит из
// /api/delegations/pending для верхнего блока inbox.
export type PendingDelegation = TaskDelegation & {
  readonly taskExcerpt: string;
};

export interface TaskDelegationRepository {
  // pending для меня как делегата (UI блок «Делегировано мне»).
  listMyPending(): Promise<PendingDelegation[]>;
  // Все поручённые мне задачи (pending+accepted) по всем проектам — плоским списком.
  // Группировку (проект/дата/дедлайн/приоритет) делает презентация (assignedGrouping.ts).
  listAssignedToMe(): Promise<AssignedTask[]>;
  // Все задачи, которые Я поручил другим (pending+accepted), по всем проектам — вкладка
  // «Другим». Тот же shape: delegation.delegateUserId/DisplayName — кому поручено.
  // Фильтрацию по конкретному человеку делает презентация.
  listDelegatedByMe(): Promise<AssignedTask[]>;
  accept(id: string): Promise<TaskDelegation>;
  decline(id: string): Promise<TaskDelegation>;
  // creator отзывает pending до accept'а.
  withdraw(id: string): Promise<void>;
}
