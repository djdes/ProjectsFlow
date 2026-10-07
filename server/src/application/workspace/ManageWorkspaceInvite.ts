import type { WorkspaceMember } from '../../domain/workspace/WorkspaceMember.js';
import { NotWorkspaceLeadError, WorkspaceInviteNotFoundError, WorkspaceInviteAlreadyUsedError, WorkspaceInviteExpiredError, WorkspaceInviteCooldownError } from '../../domain/workspace/errors.js';
import type { WorkspaceInviteRepository } from './WorkspaceInviteRepository.js';
import { requireWorkspaceEditor } from './workspaceAccess.js';

export class ManageWorkspaceInvite {
  constructor(private readonly deps: {
    workspaces: { getMembership(workspaceId: string, userId: string): Promise<WorkspaceMember | null> };
    invites: WorkspaceInviteRepository; now: () => Date; ttlMs: number; appUrl: string; onQueued?: () => void;
  }) {}

  private async get(workspaceId: string, actorUserId: string, inviteId: string) {
    const actor = await requireWorkspaceEditor(this.deps.workspaces, workspaceId, actorUserId);
    const invite = await this.deps.invites.getById(inviteId);
    if (!invite || invite.workspaceId !== workspaceId) throw new WorkspaceInviteNotFoundError();
    if (actor.role === 'editor' && invite.createdByUserId !== actorUserId) throw new NotWorkspaceLeadError();
    if (invite.acceptedAt) throw new WorkspaceInviteAlreadyUsedError();
    return invite;
  }

  async link(workspaceId: string, actorUserId: string, inviteId: string): Promise<string> {
    const invite = await this.get(workspaceId, actorUserId, inviteId);
    if (invite.expiresAt <= this.deps.now()) throw new WorkspaceInviteExpiredError();
    return `${this.deps.appUrl.replace(/\/$/, '')}/invite/${invite.token}`;
  }

  async resend(workspaceId: string, actorUserId: string, inviteId: string) {
    await this.get(workspaceId, actorUserId, inviteId);
    const now = this.deps.now();
    const updated = await this.deps.invites.rescheduleDelivery(inviteId, now, new Date(now.getTime() + this.deps.ttlMs));
    if (!updated) throw new WorkspaceInviteCooldownError();
    this.deps.onQueued?.();
    return updated;
  }
}
