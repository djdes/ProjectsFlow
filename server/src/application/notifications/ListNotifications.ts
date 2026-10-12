import type { ResolveActiveWorkspace } from '../workspace/activeWorkspace.js';
import type { Notification } from '../../domain/notifications/Notification.js';
import type { NotificationRepository } from './NotificationRepository.js';

type Deps = {
  readonly resolveActiveWorkspace: ResolveActiveWorkspace;
  readonly repo: NotificationRepository;
};

export type ListNotificationsCommand = {
  readonly userId: string;
  readonly unreadOnly: boolean;
  readonly limit: number;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export class ListNotifications {
  constructor(private readonly deps: Deps) {}

  async execute(input: ListNotificationsCommand): Promise<Notification[]> {
    const workspace = await this.deps.resolveActiveWorkspace(input.userId);
    if (!workspace) return [];
    const limit = Math.max(1, Math.min(input.limit || DEFAULT_LIMIT, MAX_LIMIT));
    return this.deps.repo.listByUser(input.userId, {
      limit,
      workspaceId: workspace.id,
      unreadOnly: input.unreadOnly,
    });
  }
}
