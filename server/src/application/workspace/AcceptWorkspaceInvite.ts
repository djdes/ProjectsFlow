import {
  WorkspaceInviteAlreadyUsedError,
  WorkspaceInviteExpiredError,
  WorkspaceInviteNotFoundError,
} from '../../domain/workspace/errors.js';
import type { WorkspaceMember, WorkspaceRole } from '../../domain/workspace/WorkspaceMember.js';
import type { WorkspaceInviteRepository } from './WorkspaceInviteRepository.js';
import { assertInviteRecipientEmail } from '../../domain/invite/recipient.js';

type WorkspacesPort = {
  getMembership(workspaceId: string, userId: string): Promise<WorkspaceMember | null>;
  addMember(workspaceId: string, userId: string, role: WorkspaceRole): Promise<void>;
  /** Слить личный дефолт-хаб юзера в целевую команду при вступлении. См. WorkspaceRepository. */
  absorbDefaultHubInto(userId: string, targetWorkspaceId: string): Promise<boolean>;
};

type Deps = {
  readonly users: { getById(id: string): Promise<{ email: string } | null> };
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
    if (invite.expiresAt.getTime() <= now.getTime()) throw new WorkspaceInviteExpiredError();
    if (invite.email !== null) {
      const user = await this.deps.users.getById(userId);
      assertInviteRecipientEmail(invite.email, user?.email ?? null);
    }

    await this.deps.invites.acceptWithMembership({
      inviteId: invite.id, acceptedAt: now, acceptedByUserId: userId,
    });

    // Joining a workspace never moves personal projects or tasks.
    return { workspaceId: invite.workspaceId };
  }
}
