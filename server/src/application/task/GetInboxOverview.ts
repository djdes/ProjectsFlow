import type { AssignedTaskView, ListTasksAssignedToMe } from './ListTasksAssignedToMe.js';
import type { ListTasksAssignedToOthers } from './ListTasksAssignedToOthers.js';
import type { ListPersonalTasksOfColleagues } from './ListPersonalTasksOfColleagues.js';
import type { ListApprovalQueue } from './ListApprovalQueue.js';
import type { AwaitingReplyView, ListTasksAwaitingMyReply } from './ListTasksAwaitingMyReply.js';

type Deps = {
  readonly listAssignedToMe: Pick<ListTasksAssignedToMe, 'execute'>;
  readonly listAssignedToOthers: Pick<ListTasksAssignedToOthers, 'execute'>;
  readonly listPersonalOfColleagues: Pick<ListPersonalTasksOfColleagues, 'execute'>;
  readonly listApprovalQueue: Pick<ListApprovalQueue, 'execute'>;
  readonly listAwaitingMyReply: Pick<ListTasksAwaitingMyReply, 'execute'>;
};

export type InboxOverview = {
  readonly mine: AssignedTaskView[];
  readonly others: AssignedTaskView[];
  readonly personal: AssignedTaskView[];
  readonly approvals: AssignedTaskView[];
  readonly awaitingReply: AwaitingReplyView[];
};

/**
 * Every list of the inbox screen in one call: assigned to me, to others, colleagues' personal
 * tasks, the approval queue and the questions awaiting my reply. Each part is produced by the
 * same use-case as its separate endpoint (same permissions, same request-workspace isolation),
 * so it equals that endpoint's answer.
 *
 * The lists run in parallel: each takes only the caller id and reads the workspace from the
 * request scope. Within the request they also share the memoized permission lookups
 * (RequestMemo), so a project or the admin flag is checked once for all five lists.
 */
export class GetInboxOverview {
  constructor(private readonly deps: Deps) {}

  async execute(userId: string): Promise<InboxOverview> {
    const [mine, others, personal, approvals, awaitingReply] = await Promise.all([
      this.deps.listAssignedToMe.execute(userId),
      this.deps.listAssignedToOthers.execute(userId),
      this.deps.listPersonalOfColleagues.execute(userId),
      this.deps.listApprovalQueue.execute(userId),
      this.deps.listAwaitingMyReply.execute(userId),
    ]);
    return { mine, others, personal, approvals, awaitingReply };
  }
}
