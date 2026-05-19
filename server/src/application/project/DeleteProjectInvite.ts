import { ProjectInviteNotFoundError } from '../../domain/project/errors.js';
import type { ProjectInviteRepository } from './ProjectInviteRepository.js';
import type { ProjectMemberRepository } from './ProjectMemberRepository.js';
import type { ProjectRepository } from './ProjectRepository.js';
import { requireProjectAccess } from './projectAccess.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly invites: ProjectInviteRepository;
};

export class DeleteProjectInvite {
  constructor(private readonly deps: Deps) {}

  // Owner отзывает invite. Если token уже использован — всё равно удаляем (idempotent
  // cleanup; никакого вреда).
  async execute(projectId: string, actorUserId: string, inviteId: string): Promise<void> {
    await requireProjectAccess(this.deps, projectId, actorUserId, 'invite_member');

    const invite = await this.deps.invites.getById(inviteId);
    if (!invite || invite.projectId !== projectId) throw new ProjectInviteNotFoundError();

    await this.deps.invites.delete(inviteId);
  }
}
