import type {
  WorkspaceInvite,
  WorkspaceInviteRole,
} from '../../domain/workspace/WorkspaceInvite.js';
import {
  NotWorkspaceOwnerError,
  WorkspaceNotFoundError,
} from '../../domain/workspace/errors.js';
import type { WorkspaceMember } from '../../domain/workspace/WorkspaceMember.js';
import type { NotificationPayload } from '../../domain/notifications/Notification.js';
import type { EmailSender } from '../notifications/EmailSender.js';
import { renderWorkspaceInviteEmail } from '../notifications/emails/workspaceInviteEmail.js';
import { requireWorkspaceMember } from './workspaceAccess.js';
import type { WorkspaceInviteRepository } from './WorkspaceInviteRepository.js';

// Узкие структурные порты — реальные репозитории (DrizzleWorkspaceRepository,
// DrizzleUserRepository, NotificationRepository) им соответствуют.
type WorkspacesPort = {
  getMembership(workspaceId: string, userId: string): Promise<WorkspaceMember | null>;
  getById(id: string): Promise<{ id: string; name: string } | null>;
};
type UsersPort = {
  getById(id: string): Promise<{ displayName: string } | null>;
  getByEmail(email: string): Promise<{ id: string } | null>;
};
type NotificationsPort = {
  create(input: { id: string; userId: string; payload: NotificationPayload }): Promise<unknown>;
};

type Deps = {
  readonly workspaces: WorkspacesPort;
  readonly invites: WorkspaceInviteRepository;
  readonly users: UsersPort;
  readonly notifications: NotificationsPort;
  readonly email: EmailSender;
  readonly idGen: () => string;
  readonly randomToken: () => string;
  readonly now: () => Date;
  readonly ttlMs: number;
  readonly appUrl: string;
};

export type CreateWorkspaceInviteCommand = {
  readonly workspaceId: string;
  readonly actorUserId: string;
  readonly role: WorkspaceInviteRole;
  // Информационный email — mismatch при accept разрешён (как у project-инвайтов).
  readonly email: string | null;
};

export class CreateWorkspaceInvite {
  constructor(private readonly deps: Deps) {}

  async execute(input: CreateWorkspaceInviteCommand): Promise<{ invite: WorkspaceInvite }> {
    // Приглашать могут owner и editor (зеркало project-права 'invite_member'); viewer — нет.
    const m = await requireWorkspaceMember(
      this.deps.workspaces,
      input.workspaceId,
      input.actorUserId,
    );
    if (m.role === 'viewer') throw new NotWorkspaceOwnerError();
    const ws = await this.deps.workspaces.getById(input.workspaceId);
    if (!ws) throw new WorkspaceNotFoundError();

    const expiresAt = new Date(this.deps.now().getTime() + this.deps.ttlMs);
    const invite = await this.deps.invites.create({
      id: this.deps.idGen(),
      workspaceId: input.workspaceId,
      role: input.role,
      token: this.deps.randomToken(),
      email: input.email,
      expiresAt,
      createdByUserId: input.actorUserId,
    });

    // Доставка — best-effort: создатель в любом случае получает token в ответе.
    if (input.email) {
      await this.notifyInvitee(input, ws.name, invite).catch((err: unknown) => {
        console.error('[ws-invite] delivery failed:', err);
      });
    }
    return { invite };
  }

  private async notifyInvitee(
    input: CreateWorkspaceInviteCommand,
    workspaceName: string,
    invite: WorkspaceInvite,
  ): Promise<void> {
    const email = input.email;
    if (!email) return;
    const actor = await this.deps.users.getById(input.actorUserId);
    const actorDisplayName = actor?.displayName ?? 'Кто-то';
    const acceptUrl = `${this.deps.appUrl.replace(/\/$/, '')}/invite/${invite.token}`;

    await this.deps.email.send(
      renderWorkspaceInviteEmail({
        to: email,
        workspaceName,
        actorDisplayName,
        role: invite.role,
        acceptUrl,
      }),
    );

    // In-app — только если у email уже есть аккаунт (отрисуется через SSE).
    const invitee = await this.deps.users.getByEmail(email);
    if (invitee) {
      await this.deps.notifications.create({
        id: this.deps.idGen(),
        userId: invitee.id,
        payload: {
          type: 'workspace_invite',
          workspaceId: invite.workspaceId,
          workspaceName,
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
