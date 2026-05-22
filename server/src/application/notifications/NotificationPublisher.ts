import type { Notification } from '../../domain/notifications/Notification.js';

// Порт real-time доставки. Реализуется in-memory хабом (SSE). Application-слой только
// «публикует» уведомление — транспорт (SSE/WS) его не волнует.
export interface NotificationPublisher {
  publish(notification: Notification): void;
}
