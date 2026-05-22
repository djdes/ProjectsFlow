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
import type { UserRepository } from '../user/UserRepository.js';
import type { NotificationRepository } from '../notifications/NotificationRepository.js';
import type { EmailSender } from '../notifications/EmailSender.js';
import { renderInviteEmail } from '../notifications/emails/inviteEmail.js';
import { requireProjectAccess } from './projectAccess.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly invites: ProjectInviteRepository;
  readonly users: UserRepository;
  readonly notifications: NotificationRepository;
  readonly email: EmailSender;
  readonly idGen: () => string;
  readonly randomToken: () => string;
  readonly now: () => Date;
  readonly ttlMs: number;
  // Базовый URL приложения для accept-ссылки в письме/уведомлении.
  readonly appUrl: string;
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

    // Доставка приглашения — best-effort: ни письмо, ни in-app-уведомление не должны
    // ронять создание invite'а (owner всё равно получит token в ответе и может скопировать).
    if (input.email) {
      await this.notifyInvitee(input, project.name, invite).catch((err: unknown) => {
        console.error('[invite] delivery failed:', err);
      });
    }

    return { invite };
  }

  private async notifyInvitee(
    input: CreateInviteCommand,
    projectName: string,
    invite: ProjectInvite,
  ): Promise<void> {
    const email = input.email;
    if (!email) return;

    const actor = await this.deps.users.getById(input.actorUserId);
    const actorDisplayName = actor?.displayName ?? 'Кто-то';
    const acceptUrl = `${this.deps.appUrl.replace(/\/$/, '')}/invite/${invite.token}`;

    // 1) Email с яркой кнопкой «Принять».
    const message = renderInviteEmail({
      to: email,
      projectName,
      actorDisplayName,
      role: invite.role,
      acceptUrl,
    });
    await this.deps.email.send(message);

    // 2) Если у email уже есть аккаунт — кладём in-app-уведомление (отрисуется без
    //    перезагрузки через SSE). Незарегистрированный — получит только письмо.
    const invitee = await this.deps.users.getByEmail(email);
    if (invitee) {
      await this.deps.notifications.create({
        id: this.deps.idGen(),
        userId: invitee.id,
        payload: {
          type: 'project_invite',
          projectId: invite.projectId,
          projectName,
          role: invite.role,
          inviteId: invite.id,
          token: invite.token,
          actorUserId: input.actorUserId,
          actorDisplayName,
        },
      });
    }
  }
}
