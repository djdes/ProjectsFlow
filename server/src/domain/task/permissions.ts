import type { TaskDelegation } from './TaskDelegation.js';

// Authorization helper для inbox-задач с делегированием.
// Creator (= owner inbox-проекта) и accepted-delegate имеют equal modify rights,
// КРОМЕ delete — только creator. Для проектных (non-inbox) задач — обычная
// projectAccess логика проходит раньше; этот helper нужен когда у тебя на руках
// Task + Delegation.

export type TaskAccessReason = 'creator' | 'accepted_delegate';

export function canModifyInboxTask(
  userId: string,
  creatorUserId: string,
  delegation: TaskDelegation | null,
): TaskAccessReason | null {
  if (userId === creatorUserId) return 'creator';
  if (
    delegation !== null &&
    delegation.status === 'accepted' &&
    delegation.delegateUserId === userId
  ) {
    return 'accepted_delegate';
  }
  return null;
}

export function canDeleteInboxTask(
  userId: string,
  creatorUserId: string,
): boolean {
  return userId === creatorUserId;
}
