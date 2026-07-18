import type { AiConversationEvent } from '../../domain/ai-conversation/AiConversationEvent.js';

type Subscriber = (event: AiConversationEvent) => void;

// Conversation-scoped in-memory tail. Durable replay comes from
// ai_conversation_events, so process restarts cannot lose accepted events.
export class AiConversationEventHub {
  private readonly subscribers = new Map<string, Set<Subscriber>>();

  subscribe(conversationId: string, subscriber: Subscriber): () => void {
    let set = this.subscribers.get(conversationId);
    if (!set) {
      set = new Set();
      this.subscribers.set(conversationId, set);
    }
    set.add(subscriber);
    return () => {
      const current = this.subscribers.get(conversationId);
      if (!current) return;
      current.delete(subscriber);
      if (current.size === 0) this.subscribers.delete(conversationId);
    };
  }

  publish(conversationId: string, event: AiConversationEvent): void {
    for (const subscriber of this.subscribers.get(conversationId) ?? []) {
      try {
        subscriber(event);
      } catch {
        // One disconnected SSE client must not block the rest of the stream.
      }
    }
  }
}
