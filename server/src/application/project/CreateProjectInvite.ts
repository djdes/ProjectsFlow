import {
  CannotInviteToInboxError,
} from '../../domain/project/errors.js';
import type {
  ProjectInvite,
  ProjectInviteRole,
} from '../../domain/project/ProjectInvite.js';
import type { ProjectInviteRepository } from './ProjectInviteRepository.js';
import type { ProjectMemberRepository } from './ProjectMemberRepository.js';
import type { ProjectRepository } from './ProjectRepository.js';
import { requireProjectAccess } from './projectAccess.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly invites: ProjectInviteRepository;
  readonly idGen: () => string;
  readonly randomToken: () => string;
  readonly now: () => Date;
  readonly ttlMs: number;
};

export type CreateInviteCommand = {
  readonly projectId: string;
  readonly actorUserId: string;
  readonly role: ProjectInviteRole;
  // Email — информационный (для кого предназначался). НЕ блокирует accept у юзера
  // с другим email (см. spec секция 7, решение #2 — mismatch разрешён).
  readonly email: string | null;
};

export type CreateInviteResult = {
  readonly invite: ProjectInvite;
};

export class CreateProjectInvite {
  constructor(private readonly deps: Deps) {}

  async execute(input: CreateInviteCommand): Promise<CreateInviteResult> {
    const { project } = await requireProjectAccess(
      this.deps,
      input.projectId,
      input.actorUserId,
      'invite_member',
    );
    // Inbox — personal, шарить нельзя (см. spec секция 7, решение #3).
    if (project.isInbox) throw new CannotInviteToInboxError();

    const expiresAt = new Date(this.deps.now().getTime() + this.deps.ttlMs);
    const invite = await this.deps.invites.create({
      id: this.deps.idGen(),
      projectId: input.projectId,
      role: input.role,
      token: this.deps.randomToken(),
      email: input.email,
      expiresAt,
      createdByUserId: input.actorUserId,
    });
    return { invite };
  }
}
