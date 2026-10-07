import type {
  WorkspaceInvite,
  WorkspaceInviteRole,
  InviteDelivery,
} from '../../domain/workspace/WorkspaceInvite.js';

export type CreateWorkspaceInviteInput = {
  readonly id: string;
  readonly workspaceId: string;
  readonly role: WorkspaceInviteRole;
  readonly token: string;
  readonly email: string | null;
  readonly excludedProjectIds?: readonly string[];
  readonly expiresAt: Date;
  readonly createdByUserId: string;
  readonly queuedAt?: Date;
};

export type AcceptWorkspaceInviteInput = {
  readonly inviteId: string;
  readonly acceptedAt: Date;
  readonly acceptedByUserId: string;
};

export interface WorkspaceInviteRepository {
  claimDelivery(now: Date): Promise<WorkspaceInvite | null>;
  finishDelivery(inviteId: string, claimedAt: Date, delivery: InviteDelivery, nextAttemptAt: Date | null): Promise<void>;
  rescheduleDelivery(inviteId: string, now: Date, expiresAt: Date): Promise<WorkspaceInvite | null>;
  /** Consume the token and add membership + visibility atomically. */
  acceptWithMembership(input: AcceptWorkspaceInviteInput): Promise<void>;
  create(input: CreateWorkspaceInviteInput): Promise<WorkspaceInvite>;
  getById(inviteId: string): Promise<WorkspaceInvite | null>;
  // Look-up из accept-flow (/invite/:token).
  findByToken(token: string): Promise<WorkspaceInvite | null>;
  // All unaccepted invitations, including expired ones so they remain visible.
  listPendingByWorkspace(workspaceId: string, now: Date): Promise<WorkspaceInvite[]>;
  markAccepted(input: AcceptWorkspaceInviteInput): Promise<WorkspaceInvite | null>;
  delete(inviteId: string): Promise<boolean>;
}
