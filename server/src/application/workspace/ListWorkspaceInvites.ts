import { NotWorkspaceOwnerError } from '../../domain/workspace/errors.js';
import type { WorkspaceInvite } from '../../domain/workspace/WorkspaceInvite.js';
import type { WorkspaceMember } from '../../domain/workspace/WorkspaceMember.js';
import { requireWorkspaceMember } from './workspaceAccess.js';
import type { WorkspaceInviteRepository } from './WorkspaceInviteRepository.js';

type WorkspacesPort = {
  getMembership(workspaceId: string, userId: string): Promise<WorkspaceMember | null>;
};

type Deps = {
  readonly workspaces: WorkspacesPort;
  readonly invites: WorkspaceInviteRepository;
  readonly now: () => Date;
};

export class ListWorkspaceInvites {
  constructor(private readonly deps: Deps) {}

  // Pending-инвайты видят owner и editor (те, кто может приглашать).
  async execute(workspaceId: string, actorUserId: string): Promise<WorkspaceInvite[]> {
    const m = await requireWorkspaceMember(this.deps.workspaces, workspaceId, actorUserId);
    if (m.role === 'viewer') throw new NotWorkspaceOwnerError();
    return this.deps.invites.listPendingByWorkspace(workspaceId, this.deps.now());
  }
}
