import type { Notification } from '../../domain/notifications/Notification.js';
import type { NotificationPublisher } from '../../application/notifications/NotificationPublisher.js';

type Subscriber = (notification: Notification) => void;

// In-memory pub/sub по userId. Хранит callback'и (не Express Response) — транспорт SSE
// инкапсулирован в роуте, хаб остаётся чистым. При рестарте процесса подписки теряются,
// что норм: EventSource на клиенте автоматически переподключается.
export class NotificationHub implements NotificationPublisher {
  private readonly subscribers = new Map<string, Set<Subscriber>>();

  subscribe(userId: string, fn: Subscriber): () => void {
    let set = this.subscribers.get(userId);
    if (!set) {
      set = new Set();
      this.subscribers.set(userId, set);
    }
    set.add(fn);
    return () => {
      const current = this.subscribers.get(userId);
      if (!current) return;
      current.delete(fn);
      if (current.size === 0) this.subscribers.delete(userId);
    };
  }

  publish(notification: Notification): void {
    const set = this.subscribers.get(notification.userId);
    if (!set) return;
    for (const fn of set) {
      try {
        fn(notification);
      } catch {
        // Один сломанный коннект не должен ронять рассылку остальным.
      }
    }
  }
}
