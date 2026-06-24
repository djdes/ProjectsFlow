import type { Notification } from '../../domain/notifications/Notification.js';
import type {
  CreateNotificationInput,
  NotificationRepository,
} from '../../application/notifications/NotificationRepository.js';
import type { NotificationPublisher } from '../../application/notifications/NotificationPublisher.js';

// Декоратор: после персиста уведомления публикует его в хаб (SSE). Так любой источник
// уведомлений (mentions, invites, join-requests) получает real-time-доставку бесплатно —
// никто не зовёт publisher напрямую.
export class PublishingNotificationRepository implements NotificationRepository {
  constructor(
    private readonly inner: NotificationRepository,
    private readonly publisher: NotificationPublisher,
  ) {}

  async create(input: CreateNotificationInput): Promise<Notification> {
    const created = await this.inner.create(input);
    this.publisher.publish(created);
    return created;
  }

  listByUser(
    userId: string,
    opts: { limit: number; unreadOnly: boolean },
  ): Promise<Notification[]> {
    return this.inner.listByUser(userId, opts);
  }

  countUnread(userId: string): Promise<number> {
    return this.inner.countUnread(userId);
  }

  countActionableUnread(userId: string): Promise<number> {
    return this.inner.countActionableUnread(userId);
  }

  markRead(id: string, userId: string, readAt: Date): Promise<boolean> {
    return this.inner.markRead(id, userId, readAt);
  }

  markAllRead(userId: string, readAt: Date): Promise<number> {
    return this.inner.markAllRead(userId, readAt);
  }
}
