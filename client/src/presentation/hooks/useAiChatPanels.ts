import { useCallback, useEffect, useState } from 'react';
import { useContainer } from '@/infrastructure/di/container';
import type { AiKnowledgeSource } from '@/domain/ai-chat/AiKnowledgeSource';
import type { AiActionArtifact } from '@/domain/ai-action/AiActionArtifact';

/**
 * Данные правой колонки чата (Knowledge / Artifacts).
 *
 * Оба списка приходят с сервера, а не собираются из стейта ленты, — поэтому они
 * переживают перезагрузку и не зависят от того, какая страница сообщений подгружена.
 * `revision` — недорогой триггер перезагрузки: вызывающий передаёт число сообщений,
 * и панели обновляются, когда в диалоге что-то произошло.
 */
export function useAiChatPanels(conversationId: string | null, revision: number): {
  knowledge: AiKnowledgeSource[];
  artifacts: AiActionArtifact[];
  loading: boolean;
} {
  const { aiConversationRepository, aiActionBatchRepository } = useContainer();
  const [knowledge, setKnowledge] = useState<AiKnowledgeSource[]>([]);
  const [artifacts, setArtifacts] = useState<AiActionArtifact[]>([]);
  const [loading, setLoading] = useState(Boolean(conversationId));

  const load = useCallback(async (signal: { cancelled: boolean }): Promise<void> => {
    if (!conversationId) {
      setKnowledge([]);
      setArtifacts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    // Панели независимы: пустая одна не должна прятать заполненную другую.
    const [sources, items] = await Promise.all([
      aiConversationRepository.listKnowledge(conversationId).catch(() => [] as AiKnowledgeSource[]),
      aiActionBatchRepository.listArtifacts(conversationId).catch(() => [] as AiActionArtifact[]),
    ]);
    if (signal.cancelled) return;
    setKnowledge(sources);
    setArtifacts(items);
    setLoading(false);
  }, [aiActionBatchRepository, aiConversationRepository, conversationId]);

  useEffect(() => {
    const signal = { cancelled: false };
    void load(signal);
    return () => { signal.cancelled = true; };
  }, [load, revision]);

  return { knowledge, artifacts, loading };
}
