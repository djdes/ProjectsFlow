import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AiConversation } from '@/domain/ai-chat/AiConversation';
import { useContainer } from '@/infrastructure/di/container';

export const AI_CONVERSATIONS_CHANGED_EVENT = 'pf:ai-conversations-changed';

export function announceAiConversationsChanged(): void {
  window.dispatchEvent(new CustomEvent(AI_CONVERSATIONS_CHANGED_EVENT));
}

/**
 * Момент последней активности диалога. Единая точка для сортировки и группировки истории:
 * если считать их по разным полям, чат окажется в группе «Сегодня», но отсортируется как старый.
 */
export function conversationActivityAt(conversation: AiConversation): number {
  const parsed = Date.parse(conversation.lastMessageAt ?? conversation.updatedAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function useAiConversations(options: { archived?: boolean; projectId?: string } = {}) {
  const { aiConversationRepository } = useContainer();
  const [items, setItems] = useState<AiConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await aiConversationRepository.list({
        scope: options.projectId ? 'project' : 'all',
        projectId: options.projectId,
        archived: options.archived ?? false,
        limit: 100,
      });
      setItems(result.items);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось загрузить чаты');
    } finally {
      setLoading(false);
    }
  }, [aiConversationRepository, options.archived, options.projectId]);

  useEffect(() => {
    void refresh();
    const onChanged = (): void => void refresh();
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener(AI_CONVERSATIONS_CHANGED_EVENT, onChanged);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener(AI_CONVERSATIONS_CHANGED_EVENT, onChanged);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  const sorted = useMemo(
    () => [...items].sort((a, b) => conversationActivityAt(b) - conversationActivityAt(a)),
    [items],
  );

  return { items: sorted, loading, error, refresh, setItems };
}
