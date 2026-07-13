import {
  WorkspaceInviteAlreadyUsedError,
  WorkspaceInviteExpiredError,
  WorkspaceInviteNotFoundError,
} from '../../domain/workspace/errors.js';
import type { WorkspaceMember, WorkspaceRole } from '../../domain/workspace/WorkspaceMember.js';
import type { WorkspaceInviteRepository } from './WorkspaceInviteRepository.js';

type WorkspacesPort = {
  getMembership(workspaceId: string, userId: string): Promise<WorkspaceMember | null>;
  addMember(workspaceId: string, userId: string, role: WorkspaceRole): Promise<void>;
};

type Deps = {
  readonly invites: WorkspaceInviteRepository;
  readonly workspaces: WorkspacesPort;
  readonly now: () => Date;
};

export class AcceptWorkspaceInvite {
  constructor(private readonly deps: Deps) {}

  async execute(token: string, userId: string): Promise<{ workspaceId: string }> {
    const invite = await this.deps.invites.findByToken(token);
    if (!invite) throw new WorkspaceInviteNotFoundError();
    if (invite.acceptedAt !== null) throw new WorkspaceInviteAlreadyUsedError();
    const now = this.deps.now();
    if (invite.expiresAt.getTime() < now.getTime()) throw new WorkspaceInviteExpiredError();

    // Уже участник — не апгрейдим/даунгрейдим роль, просто потребляем токен.
    const existing = await this.deps.workspaces.getMembership(invite.workspaceId, userId);
    if (!existing) {
      await this.deps.workspaces.addMember(invite.workspaceId, userId, invite.role);
    }

    await this.deps.invites.markAccepted({
      inviteId: invite.id,
      acceptedAt: now,
      acceptedByUserId: userId,
    });
    return { workspaceId: invite.workspaceId };
  }
}
