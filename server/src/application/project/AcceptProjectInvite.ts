import {
  ProjectInviteAlreadyUsedError,
  ProjectInviteExpiredError,
  ProjectInviteNotFoundError,
} from '../../domain/project/errors.js';
import type { ProjectInviteRepository } from './ProjectInviteRepository.js';
import type { ProjectMemberRepository } from './ProjectMemberRepository.js';
import type { UserRepository } from '../user/UserRepository.js';

type Deps = {
  readonly invites: ProjectInviteRepository;
  readonly members: ProjectMemberRepository;
  readonly users: UserRepository;
  readonly now: () => Date;
};

export type AcceptInviteResult = {
  readonly projectId: string;
};

export class AcceptProjectInvite {
  constructor(private readonly deps: Deps) {}

  async execute(token: string, userId: string): Promise<AcceptInviteResult> {
    const invite = await this.deps.invites.findByToken(token);
    if (!invite) throw new ProjectInviteNotFoundError();
    if (invite.acceptedAt !== null) throw new ProjectInviteAlreadyUsedError();
    const now = this.deps.now();
    if (invite.expiresAt.getTime() < now.getTime()) throw new ProjectInviteExpiredError();

    // Если юзер уже member — не апгрейдим/даунгрейдим, просто потребляем токен.
    // Идемпотентность: повторный клик по уже использованной ссылке (которую сами и
    // акцептнули) даёт ту же reply «ок, ты уже в проекте».
    const existing = await this.deps.members.findForProject(invite.projectId, userId);
    if (!existing) {
      await this.deps.members.add({
        projectId: invite.projectId,
        userId,
        role: invite.role,
      });
      // Копируем глобальные дефолтные notification prefs юзера (если заданы).
      try {
        const defaults = await this.deps.users.getDefaultNotificationPrefs(userId);
        if (defaults && Object.keys(defaults).length > 0) {
          await this.deps.members.setNotificationPrefs(invite.projectId, userId, defaults);
        }
      } catch {
        // Best-effort: ошибка копирования prefs не должна блокировать вступление.
      }
    }

    await this.deps.invites.markAccepted({
      inviteId: invite.id,
      acceptedAt: now,
      acceptedByUserId: userId,
    });

    return { projectId: invite.projectId };
  }
}
