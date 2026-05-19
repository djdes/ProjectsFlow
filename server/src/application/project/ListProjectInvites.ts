import type { ProjectInvite } from '../../domain/project/ProjectInvite.js';
import type { ProjectInviteRepository } from './ProjectInviteRepository.js';
import type { ProjectMemberRepository } from './ProjectMemberRepository.js';
import type { ProjectRepository } from './ProjectRepository.js';
import { requireProjectAccess } from './projectAccess.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly invites: ProjectInviteRepository;
  readonly now: () => Date;
};

export class ListProjectInvites {
  constructor(private readonly deps: Deps) {}

  // Только owner видит pending-инвайты. Возвращаем только pending (acceptedAt=null
  // и expiresAt>now) — accepted и expired не интересуют UI.
  async execute(projectId: string, actorUserId: string): Promise<ProjectInvite[]> {
    await requireProjectAccess(this.deps, projectId, actorUserId, 'invite_member');
    return this.deps.invites.listPendingByProject(projectId, this.deps.now());
  }
}
