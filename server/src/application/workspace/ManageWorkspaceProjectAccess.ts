import type { WorkspaceRepository } from './WorkspaceRepository.js';
import type { WorkspaceProjectAccessRepository } from './WorkspaceProjectAccessRepository.js';
import { requireWorkspaceLead, requireWorkspaceMember } from './workspaceAccess.js';
import { ProjectNotFoundError } from '../../domain/project/errors.js';
import { NotWorkspaceMemberError, NotWorkspaceOwnerError } from '../../domain/workspace/errors.js';

export class ManageWorkspaceProjectAccess {
  constructor(private readonly deps: {
    workspaces: Pick<WorkspaceRepository, 'getMembership' | 'listMembers'>;
    access: WorkspaceProjectAccessRepository;
    changed?: (workspaceId: string, projectId: string) => Promise<void>;
  }) {}

  async list(workspaceId: string, actorId: string) {
    const actor = await requireWorkspaceMember(this.deps.workspaces, workspaceId, actorId);
    const [projects, members, exclusions] = await Promise.all([
      this.deps.access.listProjects(workspaceId),
      this.deps.workspaces.listMembers(workspaceId),
      this.deps.access.listExclusions(workspaceId),
    ]);
    const canManage = actor.role === 'owner' || actor.role === 'lead';
    const visibleProjects = canManage ? projects : projects.filter((p) =>
      !exclusions.some((e) => e.projectId === p.id && e.userId === actorId));
    return {
      projects: visibleProjects,
      members: members.map((m) => ({
        userId: m.userId,
        hiddenProjectIds: m.role === 'owner' || m.role === 'lead' ? [] : exclusions
          .filter((e) => e.userId === m.userId && visibleProjects.some((p) => p.id === e.projectId))
          .map((e) => e.projectId),
      })),
    };
  }

  async set(workspaceId: string, actorId: string, projectId: string, userId: string, visible: boolean): Promise<void> {
    await requireWorkspaceLead(this.deps.workspaces, workspaceId, actorId);
    const target = await this.deps.workspaces.getMembership(workspaceId, userId);
    if (!target) throw new NotWorkspaceMemberError();
    // Managers must retain the access they need to administer the workspace.
    if (!visible && (target.role === 'owner' || target.role === 'lead')) throw new NotWorkspaceOwnerError();
    const projects = await this.deps.access.listProjects(workspaceId);
    if (!projects.some((p) => p.id === projectId)) throw new ProjectNotFoundError();
    await this.deps.access.setAccess(workspaceId, projectId, userId, visible);
    await this.deps.changed?.(workspaceId, projectId).catch((error: unknown) => {
      console.error('[workspace-access] refresh failed', error);
    });
  }
}
