import type { RealtimeEvent } from '../../domain/realtime/RealtimeEvent.js';
import type { RealtimePublisher } from '../../application/realtime/RealtimePublisher.js';

type Subscriber = (event: RealtimeEvent) => void;

// In-memory pub/sub по userId — близнец NotificationHub, но для «тихих» realtime-событий.
// Транспорт SSE инкапсулирован в роуте /notifications/stream. При рестарте подписки
// теряются — EventSource переподключается сам.
export class RealtimeHub implements RealtimePublisher {
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

  publish(userId: string, event: RealtimeEvent): void {
    const set = this.subscribers.get(userId);
    if (!set) return;
    for (const fn of set) {
      try {
        fn(event);
      } catch {
        // Один сломанный коннект не должен ронять рассылку остальным.
      }
    }
  }
}
