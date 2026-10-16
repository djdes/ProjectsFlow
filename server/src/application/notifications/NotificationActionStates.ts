import {
  ACTIONABLE_NOTIFICATION_TYPES,
  type Notification,
  type NotificationActionState,
} from '../../domain/notifications/Notification.js';
import type { JoinRequestStatus } from '../../domain/project/ProjectJoinRequest.js';
import type { NotificationRepository } from './NotificationRepository.js';

type InviteState = { readonly acceptedAt: Date | null; readonly expiresAt: Date };

type Deps = {
  readonly repo: Pick<NotificationRepository, 'listByUser' | 'markRead'>;
  readonly joinRequests: {
    getById(id: string): Promise<{ status: JoinRequestStatus; projectId: string; requesterUserId: string } | null>;
  };
  readonly projectInvites: { getById(id: string): Promise<InviteState | null> };
  readonly workspaceInvites: { getById(id: string): Promise<InviteState | null> };
  readonly hasProjectAccess: (projectId: string, userId: string) => Promise<boolean>;
  readonly isWorkspaceMember: (workspaceId: string, userId: string) => Promise<boolean>;
  readonly now: () => Date;
};

const ACTIONABLE: ReadonlySet<string> = new Set(ACTIONABLE_NOTIFICATION_TYPES);
const RECONCILE_LIMIT = 50;

// Приглашения и запросы доступа устаревают без участия получателя: запрос принял другой
// админ, по приглашению вошли из письма, проект удалили. Кнопка «Принять» на таком
// уведомлении вела в ошибку (not_found), поэтому её судьбу решают живые данные, а не readAt.
export class NotificationActionStates {
  constructor(private readonly deps: Deps) {}

  async stateOf(n: Notification): Promise<NotificationActionState | null> {
    const p = n.payload;
    switch (p.type) {
      case 'join_request': {
        const request = await this.deps.joinRequests.getById(p.joinRequestId);
        if (!request) return 'expired';
        if (request.status !== 'pending') return request.status;
        // Доступ уже выдали в обход запроса — отвечать незачем.
        return (await this.deps.hasProjectAccess(request.projectId, request.requesterUserId)) ? 'accepted' : 'pending';
      }
      case 'project_invite': {
        const invite = await this.deps.projectInvites.getById(p.inviteId);
        if (invite?.acceptedAt || (await this.deps.hasProjectAccess(p.projectId, n.userId))) return 'accepted';
        return invite && invite.expiresAt > this.deps.now() ? 'pending' : 'expired';
      }
      case 'workspace_invite': {
        const invite = await this.deps.workspaceInvites.getById(p.inviteId);
        if (invite?.acceptedAt || (await this.deps.isWorkspaceMember(p.workspaceId, n.userId))) return 'accepted';
        return invite && invite.expiresAt > this.deps.now() ? 'pending' : 'expired';
      }
      default:
        return null;
    }
  }

  // Состояние каждому уведомлению с действием — строка решает, показывать ли кнопки.
  // Сбой проверки не прячет кнопку: пусть лучше ответит сам сервер действия.
  async attach(list: readonly Notification[]): Promise<Notification[]> {
    return Promise.all(
      list.map(async (n) => {
        if (!ACTIONABLE.has(n.payload.type)) return n;
        const actionState = await this.stateOf(n).catch((): NotificationActionState => 'pending');
        return actionState ? { ...n, actionState } : n;
      }),
    );
  }

  // Непрочитанные приглашения и запросы, на которые отвечать уже не нужно, помечаем
  // прочитанными — иначе они держат «Ждут ответа», бейдж колокольчика и вкладку «Действие».
  // Уборка попутная: её сбой не должен ронять список или счётчик.
  async reconcile(userId: string, workspaceId: string): Promise<void> {
    try {
      const open = await this.deps.repo.listByUser(userId, {
        limit: RECONCILE_LIMIT,
        unreadOnly: true,
        workspaceId,
        actionableOnly: true,
      });
      for (const n of open) {
        const state = await this.stateOf(n).catch(() => null);
        if (state && state !== 'pending') await this.deps.repo.markRead(n.id, userId, this.deps.now(), workspaceId);
      }
    } catch {
      /* следующий запрос попробует снова */
    }
  }
}
