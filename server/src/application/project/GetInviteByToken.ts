import {
  ProjectInviteAlreadyUsedError,
  ProjectInviteExpiredError,
  ProjectInviteNotFoundError,
  ProjectNotFoundError,
} from '../../domain/project/errors.js';
import type { ProjectInviteRole } from '../../domain/project/ProjectInvite.js';
import type { ProjectInviteRepository } from './ProjectInviteRepository.js';
import type { ProjectRepository } from './ProjectRepository.js';
import type { UserRepository } from '../user/UserRepository.js';

type Deps = {
  readonly invites: ProjectInviteRepository;
  readonly projects: ProjectRepository;
  readonly users: UserRepository;
  readonly now: () => Date;
};

// Preview-данные инвайта для anon-страницы /invite/:token. НЕ возвращаем project_id —
// у анона нет повода знать его до accept'а (защита от перебора по токенам).
export type InvitePreview = {
  readonly projectName: string;
  readonly role: ProjectInviteRole;
  readonly inviterDisplayName: string | null;
  readonly inviteEmail: string | null;
  readonly expiresAt: Date;
};

export class GetInviteByToken {
  constructor(private readonly deps: Deps) {}

  async execute(token: string): Promise<InvitePreview> {
    const invite = await this.deps.invites.findByToken(token);
    if (!invite) throw new ProjectInviteNotFoundError();
    if (invite.acceptedAt !== null) throw new ProjectInviteAlreadyUsedError();
    if (invite.expiresAt.getTime() < this.deps.now().getTime()) {
      throw new ProjectInviteExpiredError();
    }

    const project = await this.deps.projects.getById(invite.projectId);
    if (!project) throw new ProjectNotFoundError();
    const inviter = await this.deps.users.getById(invite.createdByUserId);

    return {
      projectName: project.name,
      role: invite.role,
      inviterDisplayName: inviter?.displayName ?? null,
      inviteEmail: invite.email,
      expiresAt: invite.expiresAt,
    };
  }
}
