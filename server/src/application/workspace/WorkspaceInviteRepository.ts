import type {
  WorkspaceInvite,
  WorkspaceInviteRole,
} from '../../domain/workspace/WorkspaceInvite.js';

export type CreateWorkspaceInviteInput = {
  readonly id: string;
  readonly workspaceId: string;
  readonly role: WorkspaceInviteRole;
  readonly token: string;
  readonly email: string | null;
  readonly expiresAt: Date;
  readonly createdByUserId: string;
};

export type AcceptWorkspaceInviteInput = {
  readonly inviteId: string;
  readonly acceptedAt: Date;
  readonly acceptedByUserId: string;
};

export interface WorkspaceInviteRepository {
  create(input: CreateWorkspaceInviteInput): Promise<WorkspaceInvite>;
  getById(inviteId: string): Promise<WorkspaceInvite | null>;
  // Look-up из accept-flow (/invite/:token).
  findByToken(token: string): Promise<WorkspaceInvite | null>;
  // Pending-инвайты пространства (acceptedAt IS NULL, expiresAt > now) — для UI «Команда».
  listPendingByWorkspace(workspaceId: string, now: Date): Promise<WorkspaceInvite[]>;
  markAccepted(input: AcceptWorkspaceInviteInput): Promise<WorkspaceInvite | null>;
  delete(inviteId: string): Promise<boolean>;
}
