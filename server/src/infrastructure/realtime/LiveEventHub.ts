import type { LiveEvent } from '../../domain/live/LiveEvent.js';
import type { LiveSessionFinalStatus } from '../../domain/live/LiveSession.js';

type EventSub = (events: readonly LiveEvent[]) => void;
type EndSub = (status: LiveSessionFinalStatus) => void;

// In-memory firehose live-событий, keyed by taskId — зеркало RealtimeHub, но task-scoped
// и НЕ per-user. Используется ТОЛЬКО SSE-роутом /stream: общий per-user bus
// (/notifications/stream) нельзя заваливать всеми событиями всех задач (шум/нагрузка).
// Бейдж 🔴 (мало событий) идёт по общему bus через ProjectEventBroadcaster; полный firehose —
// только в открытую LIVE-вкладку. При рестарте подписки теряются — EventSource переподключается
// и доигрывает пропущенное через replay (afterSeq из БД).
export class LiveEventHub {
  private readonly eventSubs = new Map<string, Set<EventSub>>();
  private readonly endSubs = new Map<string, Set<EndSub>>();

  // Подписка на поток событий конкретной задачи. Возвращает unsubscribe.
  subscribe(taskId: string, fn: EventSub): () => void {
    let set = this.eventSubs.get(taskId);
    if (!set) {
      set = new Set();
      this.eventSubs.set(taskId, set);
    }
    set.add(fn);
    return () => {
      const current = this.eventSubs.get(taskId);
      if (!current) return;
      current.delete(fn);
      if (current.size === 0) this.eventSubs.delete(taskId);
    };
  }

  // Подписка на завершение сессии задачи (event: live_end). Возвращает unsubscribe.
  subscribeEnd(taskId: string, fn: EndSub): () => void {
    let set = this.endSubs.get(taskId);
    if (!set) {
      set = new Set();
      this.endSubs.set(taskId, set);
    }
    set.add(fn);
    return () => {
      const current = this.endSubs.get(taskId);
      if (!current) return;
      current.delete(fn);
      if (current.size === 0) this.endSubs.delete(taskId);
    };
  }

  publish(taskId: string, events: readonly LiveEvent[]): void {
    if (events.length === 0) return;
    const set = this.eventSubs.get(taskId);
    if (!set) return;
    for (const fn of set) {
      try {
        fn(events);
      } catch {
        // Один сломанный коннект не должен ронять рассылку остальным.
      }
    }
  }

  publishEnd(taskId: string, status: LiveSessionFinalStatus): void {
    const set = this.endSubs.get(taskId);
    if (!set) return;
    for (const fn of set) {
      try {
        fn(status);
      } catch {
        // см. выше.
      }
    }
  }
}
