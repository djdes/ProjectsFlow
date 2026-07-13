import { ProjectNotFoundError } from '../../domain/project/errors.js';
import type { JoinRequestStatus } from '../../domain/project/ProjectJoinRequest.js';
import type { ProjectMemberRepository } from './ProjectMemberRepository.js';
import type { ProjectRepository } from './ProjectRepository.js';
import type { ProjectJoinRequestRepository } from './ProjectJoinRequestRepository.js';
import type {
  WorkspaceMember,
  WorkspaceRole,
} from '../../domain/workspace/WorkspaceMember.js';
import { requireProjectAccess } from './projectAccess.js';

type WorkspacesPort = {
  getMembership(workspaceId: string, userId: string): Promise<WorkspaceMember | null>;
  addMember(workspaceId: string, userId: string, role: WorkspaceRole): Promise<void>;
};

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly joinRequests: ProjectJoinRequestRepository;
  readonly workspaces: WorkspacesPort;
  readonly now: () => Date;
};

// Владелец (или admin) принимает/отклоняет заявку по git-коллизии. Accept → заявитель
// зачисляется в ПРОСТРАНСТВО проекта с ролью editor (спека unified-workspace §3.2):
// доступ к проекту дальше деривится через workspace_members, project_members не пишем.
export class ResolveProjectJoinRequest {
  constructor(private readonly deps: Deps) {}

  async execute(
    joinRequestId: string,
    actorUserId: string,
    accept: boolean,
  ): Promise<{ status: JoinRequestStatus }> {
    const jr = await this.deps.joinRequests.getById(joinRequestId);
    if (!jr) throw new ProjectNotFoundError();

    // Решать может только тот, кто вправе приглашать (owner проекта или admin-bypass).
    await requireProjectAccess(this.deps, jr.projectId, actorUserId, 'invite_member');

    if (jr.status !== 'pending') return { status: jr.status };

    if (accept) {
      const workspaceId = await this.deps.projects.getWorkspaceId(jr.projectId);
      if (!workspaceId) throw new ProjectNotFoundError();
      const existing = await this.deps.workspaces.getMembership(
        workspaceId,
        jr.requesterUserId,
      );
      if (!existing) {
        await this.deps.workspaces.addMember(workspaceId, jr.requesterUserId, 'editor');
      }
    }

    const status: Exclude<JoinRequestStatus, 'pending'> = accept ? 'accepted' : 'declined';
    await this.deps.joinRequests.resolve(joinRequestId, status, actorUserId, this.deps.now());
    return { status };
  }
}
