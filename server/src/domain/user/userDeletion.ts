import type { WorkspaceKind } from '../workspace/Workspace.js';
import type { WorkspaceRole } from '../workspace/WorkspaceMember.js';

// Everything the deletion rules need to know about one account, read inside the deleting
// transaction. Only workspaces the user belongs to, owns or has tasks in are listed.
export type UserDeletionWorkspace = {
  readonly id: string;
  readonly name: string;
  readonly kind: WorkspaceKind;
  // Role of the deleted user in the workspace; null when they are not a member any more.
  readonly role: WorkspaceRole | null;
  // workspaces.owner_user_id points at the deleted user.
  readonly recordedOwner: boolean;
  // Other members whose accounts are active.
  readonly otherActiveMembers: number;
  // Who takes over the user's tasks and projects: the recorded owner when it is somebody
  // else, otherwise another active member with the owner role. null when there is nobody.
  readonly successor: { readonly id: string; readonly displayName: string } | null;
  // Whether the successor is an owner-role member, i.e. can inherit workspaces.owner_user_id.
  readonly successorIsOwner: boolean;
};

export type UserDeletionProject = {
  readonly id: string;
  readonly name: string;
  readonly workspaceId: string;
  readonly isInbox: boolean;
  readonly ownerId: string;
  // Tasks outside the trash (the trash goes along with the project).
  readonly taskCount: number;
  // Tasks of the deleted user, the trash included: an assignee is mandatory everywhere.
  readonly assignedToUser: number;
};

export type UserDeletionSnapshot = {
  readonly userId: string;
  readonly isAdmin: boolean;
  readonly workspaces: readonly UserDeletionWorkspace[];
  readonly projects: readonly UserDeletionProject[];
};

export type UserDeletionBlocker =
  | { readonly kind: 'self' }
  | { readonly kind: 'admin' }
  | { readonly kind: 'owned_workspace'; readonly workspaceId: string; readonly name: string; readonly members: number };

export type UserDeletionPlan = {
  readonly blockers: readonly UserDeletionBlocker[];
  // Workspaces removed with all their projects (the user is the only active member).
  readonly removeWorkspaces: readonly { readonly id: string; readonly name: string; readonly kind: WorkspaceKind }[];
  // Projects hard-deleted: everything in removed workspaces plus the user's own inboxes.
  readonly removeProjectIds: readonly string[];
  // Surviving projects where the user's tasks (and project ownership) move to the successor.
  readonly reassignments: readonly { readonly projectId: string; readonly toUserId: string; readonly tasks: number; readonly ownership: boolean }[];
  // Surviving workspaces whose recorded owner changes.
  readonly ownerTransfers: readonly { readonly workspaceId: string; readonly toUserId: string }[];
  readonly summary: {
    readonly removedProjects: number;
    readonly removedTasks: number;
    readonly reassignedTasks: number;
    readonly leftWorkspaces: readonly { readonly name: string; readonly successorName: string | null }[];
  };
};

// Decides what an admin deletion does. Pure: the same rules serve the preview dialog and
// the transaction, so the summary the admin confirms is exactly what gets executed.
export function planUserDeletion(snapshot: UserDeletionSnapshot, actorId: string): UserDeletionPlan {
  const blockers: UserDeletionBlocker[] = [];
  if (snapshot.userId === actorId) blockers.push({ kind: 'self' });
  if (snapshot.isAdmin) blockers.push({ kind: 'admin' });

  const removed = new Set<string>();
  const removeWorkspaces: { id: string; name: string; kind: WorkspaceKind }[] = [];
  const ownerTransfers: { workspaceId: string; toUserId: string }[] = [];
  const leftWorkspaces: { name: string; successorName: string | null }[] = [];
  for (const ws of snapshot.workspaces) {
    const owns = ws.role === 'owner' || ws.recordedOwner;
    if (owns && ws.otherActiveMembers === 0) {
      removed.add(ws.id);
      removeWorkspaces.push({ id: ws.id, name: ws.name, kind: ws.kind });
      continue;
    }
    // Team data must never disappear with one account: the owner hands it over first.
    if (!ws.successor || (owns && !ws.successorIsOwner)) {
      blockers.push({ kind: 'owned_workspace', workspaceId: ws.id, name: ws.name, members: ws.otherActiveMembers });
      continue;
    }
    if (ws.recordedOwner) ownerTransfers.push({ workspaceId: ws.id, toUserId: ws.successor.id });
    if (ws.role !== null) leftWorkspaces.push({ name: ws.name, successorName: ws.successor.displayName });
  }

  const successorOf = new Map(snapshot.workspaces.map((ws) => [ws.id, ws.successor?.id ?? null]));
  const removeProjectIds: string[] = [];
  const reassignments: { projectId: string; toUserId: string; tasks: number; ownership: boolean }[] = [];
  let removedTasks = 0;
  let reassignedTasks = 0;
  for (const p of snapshot.projects) {
    const ownedByUser = p.ownerId === snapshot.userId;
    if (removed.has(p.workspaceId) || (p.isInbox && ownedByUser)) {
      removeProjectIds.push(p.id);
      removedTasks += p.taskCount;
      continue;
    }
    // Someone else's inbox stays personal: its tasks go back to the inbox owner.
    const toUserId = p.isInbox ? p.ownerId : successorOf.get(p.workspaceId);
    if (!toUserId || (p.assignedToUser === 0 && !ownedByUser)) continue;
    reassignments.push({ projectId: p.id, toUserId, tasks: p.assignedToUser, ownership: ownedByUser });
    reassignedTasks += p.assignedToUser;
  }

  return {
    blockers,
    removeWorkspaces,
    removeProjectIds,
    reassignments,
    ownerTransfers,
    summary: { removedProjects: removeProjectIds.length, removedTasks, reassignedTasks, leftWorkspaces },
  };
}

export function describeDeletionBlockers(blockers: readonly UserDeletionBlocker[]): string {
  return blockers.map((b) => {
    if (b.kind === 'self') return 'Нельзя удалить свою учётную запись.';
    if (b.kind === 'admin') return 'Сначала снимите права администратора.';
    return `Пространство «${b.name}»: назначьте другого владельца в настройках пространства, `
      + 'затем повторите удаление.';
  }).join(' ');
}
