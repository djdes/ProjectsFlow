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
  /** Слить личный дефолт-хаб юзера в целевую команду при вступлении. См. WorkspaceRepository. */
  absorbDefaultHubInto(userId: string, targetWorkspaceId: string): Promise<boolean>;
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
    if (invite.expiresAt.getTime() <= now.getTime()) throw new WorkspaceInviteExpiredError();

    await this.deps.invites.acceptWithMembership({
      inviteId: invite.id, acceptedAt: now, acceptedByUserId: userId,
    });

    // Мёржим личный дефолт-хаб юзера в команду при вступлении (durability, "слить, не
    // скрыть"). Вызываем БЕЗУСЛОВНО (идемпотентно, no-op если хаба нет) — чинит и тех, кто
    // вступил до появления этой фичи и всё ещё видит два «Пространства».
    await this.deps.workspaces.absorbDefaultHubInto(userId, invite.workspaceId).catch((error: unknown) => {
      // Membership is already durable; a housekeeping failure must not turn a used
      // invitation into an apparent failure for the recipient.
      console.error('[ws-invite] hub merge failed', error);
    });

    return { workspaceId: invite.workspaceId };
  }
}
