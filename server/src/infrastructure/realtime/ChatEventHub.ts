import type { ChatStreamEvent } from '../../domain/chat/ChatEvent.js';

type Sub = (event: ChatStreamEvent) => void;

// In-memory firehose событий чата, keyed by workspaceId — зеркало LiveEventHub, но
// workspace-scoped и НЕ per-user. Используется ТОЛЬКО SSE-роутом /stream чата: общий
// per-user bus (RealtimeHub) нельзя заваливать всеми сообщениями всех пространств.
// Бейдж непрочитанного идёт по общему bus (workspace_chat_changed); полная лента — только
// в открытую вкладку чата. При рестарте подписки теряются — EventSource переподключается
// и доигрывает пропущенное через replay (afterSeq из БД).
export class ChatEventHub {
  private readonly subs = new Map<string, Set<Sub>>();

  subscribe(workspaceId: string, fn: Sub): () => void {
    let set = this.subs.get(workspaceId);
    if (!set) {
      set = new Set();
      this.subs.set(workspaceId, set);
    }
    set.add(fn);
    return () => {
      const current = this.subs.get(workspaceId);
      if (!current) return;
      current.delete(fn);
      if (current.size === 0) this.subs.delete(workspaceId);
    };
  }

  publish(workspaceId: string, event: ChatStreamEvent): void {
    const set = this.subs.get(workspaceId);
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
