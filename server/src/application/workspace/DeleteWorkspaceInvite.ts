import { WorkspaceInviteNotFoundError } from '../../domain/workspace/errors.js';
import type { WorkspaceMember } from '../../domain/workspace/WorkspaceMember.js';
import { requireWorkspaceEditor } from './workspaceAccess.js';
import type { WorkspaceInviteRepository } from './WorkspaceInviteRepository.js';

type WorkspacesPort = {
  getMembership(workspaceId: string, userId: string): Promise<WorkspaceMember | null>;
};

type Deps = {
  readonly workspaces: WorkspacesPort;
  readonly invites: WorkspaceInviteRepository;
};

export class DeleteWorkspaceInvite {
  constructor(private readonly deps: Deps) {}

  // Idempotent cleanup: использованный invite тоже можно удалить.
  async execute(workspaceId: string, actorUserId: string, inviteId: string): Promise<void> {
    await requireWorkspaceEditor(this.deps.workspaces, workspaceId, actorUserId);

    const invite = await this.deps.invites.getById(inviteId);
    if (!invite || invite.workspaceId !== workspaceId) throw new WorkspaceInviteNotFoundError();

    await this.deps.invites.delete(inviteId);
  }
}
