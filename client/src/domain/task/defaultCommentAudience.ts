import type { CommentNotifyCandidate, NotifyAudience } from './TaskComment';

/**
 * Who a new comment notifies unless the author chooses otherwise.
 *
 * Once the candidates are loaded the server's choice wins (the task's manager, see
 * CommentNotifyCandidate.isDefault). Until then the assignee is a safe interim default.
 */
export function defaultCommentAudience(
  candidates: readonly CommentNotifyCandidate[] | null,
  assigneeUserId: string | null,
  authorUserId: string | null,
): NotifyAudience {
  if (candidates) {
    const ids = candidates.filter((c) => c.isDefault).map((c) => c.userId);
    return ids.length > 0 ? { mode: 'selected', userIds: ids } : { mode: 'none' };
  }
  return assigneeUserId && authorUserId && assigneeUserId !== authorUserId
    ? { mode: 'selected', userIds: [assigneeUserId] }
    : { mode: 'none' };
}
