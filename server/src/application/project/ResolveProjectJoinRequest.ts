import { ProjectNotFoundError } from '../../domain/project/errors.js';
import type { JoinRequestStatus } from '../../domain/project/ProjectJoinRequest.js';
import type { ProjectMemberRepository } from './ProjectMemberRepository.js';
import type { ProjectRepository } from './ProjectRepository.js';
import type { ProjectJoinRequestRepository } from './ProjectJoinRequestRepository.js';
import { requireProjectAccess } from './projectAccess.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly joinRequests: ProjectJoinRequestRepository;
  readonly now: () => Date;
};

// Владелец (или admin) принимает/отклоняет заявку. Accept → заявитель становится editor.
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
      const existing = await this.deps.members.findForProject(jr.projectId, jr.requesterUserId);
      if (!existing) {
        await this.deps.members.add({
          projectId: jr.projectId,
          userId: jr.requesterUserId,
          role: 'editor',
        });
      }
    }

    const status: Exclude<JoinRequestStatus, 'pending'> = accept ? 'accepted' : 'declined';
    await this.deps.joinRequests.resolve(joinRequestId, status, actorUserId, this.deps.now());
    return { status };
  }
}
