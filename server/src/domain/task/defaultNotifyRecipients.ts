export type DefaultNotifyRecipientsInput = {
  // Comment author: never selected by default.
  readonly actorUserId: string;
  // Everyone who can open the task (the only people who may be notified at all).
  readonly candidateUserIds: readonly string[];
  // Workspace roles of the task's workspace.
  readonly leadUserIds: readonly string[];
  readonly ownerUserIds: readonly string[];
  readonly assigneeUserId: string | null;
};

/**
 * Who the comment composer notifies unless the author picks someone else.
 *
 * A comment usually reports to management, so the default is the people who accept the
 * work ("Кто утверждает"): the workspace leads, or the workspace owner when no other lead
 * is available. When the author is a lead or owner himself, notifying a fellow manager
 * would be noise: the comment is addressed to the executor, so the default is the
 * assignee. The author is never selected; with nobody left the default is "nobody".
 */
export function defaultNotifyRecipientIds(input: DefaultNotifyRecipientsInput): string[] {
  const candidates = new Set(input.candidateUserIds);
  const eligible = (id: string): boolean => id !== input.actorUserId && candidates.has(id);
  const assignee =
    input.assigneeUserId && eligible(input.assigneeUserId) ? [input.assigneeUserId] : [];
  const actorIsManager =
    input.leadUserIds.includes(input.actorUserId) || input.ownerUserIds.includes(input.actorUserId);
  if (actorIsManager) return assignee;

  const leads = unique(input.leadUserIds.filter(eligible));
  if (leads.length > 0) return leads;
  const owners = unique(input.ownerUserIds.filter(eligible));
  if (owners.length > 0) return owners;
  return assignee;
}

function unique(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}
