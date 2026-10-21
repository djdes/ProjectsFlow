import type { NotifyAudience } from './TaskComment';

/** New comments notify the task assignee unless the author chooses otherwise. */
export function defaultCommentAudience(
  assigneeUserId: string | null,
  authorUserId: string | null,
): NotifyAudience {
  return assigneeUserId && authorUserId && assigneeUserId !== authorUserId
    ? { mode: 'selected', userIds: [assigneeUserId] }
    : { mode: 'none' };
}
