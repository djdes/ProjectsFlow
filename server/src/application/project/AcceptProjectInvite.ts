import {
  ProjectInviteAlreadyUsedError,
  ProjectInviteExpiredError,
  ProjectInviteNotFoundError,
} from '../../domain/project/errors.js';
import type { ProjectInviteRepository } from './ProjectInviteRepository.js';
import type { ProjectMemberRepository } from './ProjectMemberRepository.js';
import type { UserRepository } from '../user/UserRepository.js';
import type { ActivityRecorder } from '../activity/ActivityRecorder.js';
import type { HubMembershipSync } from '../workspace/HubMembershipSync.js';

type Deps = {
  readonly invites: ProjectInviteRepository;
  readonly members: ProjectMemberRepository;
  readonly users: UserRepository;
  readonly now: () => Date;
  // Лента действий (best-effort). Опционально.
  readonly activityRecorder?: ActivityRecorder;
  // Синк участников дефолт-хаба владельца (best-effort). Опционально.
  readonly hubSync?: HubMembershipSync;
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
      // Лента действий (best-effort): новый участник присоединился по инвайту.
      void this.deps.activityRecorder?.record({
        projectId: invite.projectId,
        actorUserId: userId,
        kind: 'member_added',
        payload: { targetUserId: userId, role: invite.role },
      });
      // Добавляем в хаб-чат владельца проекта (best-effort: не блокирует вступление).
      try {
        await this.deps.hubSync?.onMemberAdded(invite.projectId, userId);
      } catch {
        // Синк хаба не должен ломать вступление в проект — drift поправит следующая операция/миграция.
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
