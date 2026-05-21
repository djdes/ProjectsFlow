import type { Notification } from '../../domain/notifications/Notification.js';
import type { NotificationRepository } from './NotificationRepository.js';

type Deps = {
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

  execute(input: ListNotificationsCommand): Promise<Notification[]> {
    const limit = Math.max(1, Math.min(input.limit || DEFAULT_LIMIT, MAX_LIMIT));
    return this.deps.repo.listByUser(input.userId, {
      limit,
      unreadOnly: input.unreadOnly,
    });
  }
}
