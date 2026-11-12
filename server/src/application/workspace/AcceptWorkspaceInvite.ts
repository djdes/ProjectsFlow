import {
  WorkspaceInviteAlreadyUsedError,
  WorkspaceInviteExpiredError,
  WorkspaceInviteNotFoundError,
} from '../../domain/workspace/errors.js';
import type { WorkspaceMember, WorkspaceRole } from '../../domain/workspace/WorkspaceMember.js';
import type { WorkspaceInviteRepository } from './WorkspaceInviteRepository.js';
import { assertInviteRecipientEmail } from '../../domain/invite/recipient.js';

type WorkspacesPort = {
  getMembership(workspaceId: string, userId: string): Promise<WorkspaceMember | null>;
  addMember(workspaceId: string, userId: string, role: WorkspaceRole): Promise<void>;
  /** Слить личный дефолт-хаб юзера в целевую команду при вступлении. См. WorkspaceRepository. */
  absorbDefaultHubInto(userId: string, targetWorkspaceId: string): Promise<boolean>;
};

// Следующий шаг с Telegram после вступления по приглашению из рабочей Telegram-группы
// (db/181): pair — ссылка подключения Telegram для владельца аккаунта; linked — у аккаунта
// уже тот же Telegram, задача создаётся; conflict — у аккаунта другой Telegram.
export type InviteAcceptedTelegram =
  | { readonly status: 'pair'; readonly url: string }
  | { readonly status: 'linked' }
  | { readonly status: 'conflict' }
  | null;

type Deps = {
  readonly users: { getById(id: string): Promise<{ email: string } | null> };
  readonly invites: WorkspaceInviteRepository;
  readonly workspaces: WorkspacesPort;
  readonly now: () => Date;
  // Проверка до вступления (приглашение бота: группа ещё рабочая, человека не удаляли).
  readonly beforeAccept?: (input: { readonly inviteId: string; readonly userId: string }) => Promise<void>;
  readonly onAccepted?: (input: {
    readonly inviteId: string;
    readonly workspaceId: string;
    readonly userId: string;
  }) => Promise<{ telegram: InviteAcceptedTelegram }>;
};

export class AcceptWorkspaceInvite {
  constructor(private readonly deps: Deps) {}

  async execute(
    token: string,
    userId: string,
  ): Promise<{ workspaceId: string; telegram: InviteAcceptedTelegram }> {
    const invite = await this.deps.invites.findByToken(token);
    if (!invite) throw new WorkspaceInviteNotFoundError();
    if (invite.acceptedAt !== null) throw new WorkspaceInviteAlreadyUsedError();
    const now = this.deps.now();
    if (invite.expiresAt.getTime() <= now.getTime()) throw new WorkspaceInviteExpiredError();
    if (invite.email !== null) {
      const user = await this.deps.users.getById(userId);
      assertInviteRecipientEmail(invite.email, user?.email ?? null);
    }

    await this.deps.beforeAccept?.({ inviteId: invite.id, userId });

    await this.deps.invites.acceptWithMembership({
      inviteId: invite.id, acceptedAt: now, acceptedByUserId: userId,
    });

    // Хук — дополнение: его сбой не отменяет уже состоявшееся вступление.
    let telegram: InviteAcceptedTelegram = null;
    if (this.deps.onAccepted) {
      try {
        ({ telegram } = await this.deps.onAccepted({
          inviteId: invite.id,
          workspaceId: invite.workspaceId,
          userId,
        }));
      } catch (err) {
        console.warn('[workspace-invite] accept hook failed:', err);
      }
    }

    // Joining a workspace never moves personal projects or tasks.
    return { workspaceId: invite.workspaceId, telegram };
  }
}
