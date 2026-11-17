import type { Notification } from '../../domain/notifications/Notification.js';
import type { NotificationPublisher } from '../../application/notifications/NotificationPublisher.js';

// Several delivery channels for a created notification: the SSE hub of open tabs and Web Push to
// devices. A failing channel neither blocks the others nor reaches the notification's creator.
export class CompositeNotificationPublisher implements NotificationPublisher {
  constructor(private readonly publishers: readonly NotificationPublisher[]) {}

  publish(notification: Notification): void {
    for (const publisher of this.publishers) {
      try {
        publisher.publish(notification);
      } catch (error) {
        console.warn('[notifications] publisher failed', error);
      }
    }
  }
}
