import { PERSONAL_NOTIFICATION_TYPES, type Notification } from '../../domain/notifications/Notification.js';
import type { WorkspaceRepository } from '../workspace/WorkspaceRepository.js';
import type { NotificationRepository } from './NotificationRepository.js';

// Toasts belong to the recipient's account; workspace lists and realtime caches
// remain scoped to the open workspace. Never deliver another recipient's record
// or a former workspace member's retained task notification.
export class NotificationAlerts {
  constructor(private readonly deps: {
    repo: Pick<NotificationRepository, 'listByUser'>;
    workspaces: Pick<WorkspaceRepository, 'getMembership'>;
  }) {}

  async canReceive(userId: string, notification: Notification): Promise<boolean> {
    if (notification.userId !== userId) return false;
    if (PERSONAL_NOTIFICATION_TYPES.includes(notification.payload.type)) return true;
    return !!notification.workspaceId && !!(await this.deps.workspaces.getMembership(notification.workspaceId, userId));
  }

  async listSince(userId: string, since: Date): Promise<Notification[]> {
    const recent = await this.deps.repo.listByUser(userId, { unreadOnly: true, limit: 200 });
    const candidates = recent.filter((notification) => notification.createdAt >= since);
    const allowed = await Promise.all(candidates.map((notification) => this.canReceive(userId, notification)));
    return candidates.filter((_notification, index) => allowed[index]);
  }
}
