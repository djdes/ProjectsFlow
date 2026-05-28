// Делегирование одной inbox-задачи одному пользователю. См. db/039.
// One-to-one: одна активная (pending|accepted) делегация на task. Архивные/declined/
// withdrawn остаются для истории.
//
// Mirrored: client/src/domain/task/TaskDelegation.ts.

export type TaskDelegationStatus =
  | 'pending'
  | 'accepted'
  | 'declined'
  | 'withdrawn'
  | 'archived';

export const TASK_DELEGATION_STATUSES: readonly TaskDelegationStatus[] = [
  'pending',
  'accepted',
  'declined',
  'withdrawn',
  'archived',
];

// Активные = занимают слот «одна делегация на задачу». pending — ждёт ответа,
// accepted — делегат принял и работает. Остальные — терминальные.
export const ACTIVE_DELEGATION_STATUSES: readonly TaskDelegationStatus[] = [
  'pending',
  'accepted',
];

export type TaskDelegation = {
  readonly id: string;
  readonly taskId: string;
  readonly delegateUserId: string;
  readonly delegateDisplayName: string;
  readonly creatorUserId: string;
  readonly creatorDisplayName: string;
  readonly status: TaskDelegationStatus;
  readonly createdAt: Date;
  readonly respondedAt: Date | null;
};
