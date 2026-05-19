import {
  CannotRemoveSelfAsLastOwnerError,
  ProjectNotFoundError,
} from '../../domain/project/errors.js';
import type { ProjectMemberRepository } from './ProjectMemberRepository.js';
import type { ProjectRepository } from './ProjectRepository.js';
import { requireProjectAccess } from './projectAccess.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
};

export class RemoveProjectMember {
  constructor(private readonly deps: Deps) {}

  // Только owner может выгонять member'ов. Owner НЕ может выгнать сам себя если он
  // единственный owner проекта — иначе остался бы проект без управления.
  async execute(projectId: string, actorUserId: string, targetUserId: string): Promise<void> {
    await requireProjectAccess(this.deps, projectId, actorUserId, 'remove_member');

    const target = await this.deps.members.findForProject(projectId, targetUserId);
    if (!target) throw new ProjectNotFoundError(); // не палим, что юзер не в команде

    if (target.role === 'owner' && actorUserId === targetUserId) {
      const ownerCount = await this.deps.members.countOwners(projectId);
      if (ownerCount <= 1) throw new CannotRemoveSelfAsLastOwnerError();
    }

    await this.deps.members.remove(projectId, targetUserId);
  }
}
