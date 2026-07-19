import { useCallback, useEffect, useRef, useState } from 'react';
import type { AiConversation, AiMessage } from '@/domain/ai-chat/AiConversation';
import { useContainer } from '@/infrastructure/di/container';
import { publishAiActiveRun } from '@/presentation/components/ai/aiActiveRun';
import { announceAiConversationsChanged } from './useAiConversations';

function createClientRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function mergeMessages(current: AiMessage[], incoming: AiMessage[]): AiMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, { ...byId.get(message.id), ...message });
  return [...byId.values()].sort((a, b) => Number(a.seq) - Number(b.seq));
}

export function useAiConversation(conversationId: string | null) {
  const { aiConversationRepository } = useContainer();
  const [conversation, setConversation] = useState<AiConversation | null>(null);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [loading, setLoading] = useState(Boolean(conversationId));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastEventId = useRef<string | null>(null);

  const refresh = useCallback(async (quiet = false) => {
    if (!conversationId) {
      setConversation(null);
      setMessages([]);
      setLoading(false);
      return;
    }
    if (!quiet) setLoading(true);
    try {
      const [nextConversation, page] = await Promise.all([
        aiConversationRepository.get(conversationId),
        aiConversationRepository.listMessages(conversationId, { limit: 100 }),
      ]);
      setConversation(nextConversation);
      setMessages((current) => mergeMessages(current, page.items));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось открыть чат');
    } finally {
      setLoading(false);
    }
  }, [aiConversationRepository, conversationId]);

  useEffect(() => {
    setConversation(null);
    setMessages([]);
    setError(null);
    lastEventId.current = null;
    void refresh();
  }, [conversationId, refresh]);

  useEffect(() => {
    if (!conversationId || typeof EventSource === 'undefined') return;
    let stopped = false;
    let source: EventSource | null = null;
    let pollTimer: number | null = null;

    const poll = (): void => {
      if (!stopped) void refresh(true);
    };
    try {
      source = new EventSource(aiConversationRepository.streamUrl(conversationId, lastEventId.current));
      const onEvent = (event: MessageEvent): void => {
        lastEventId.current = event.lastEventId || lastEventId.current;
        poll();
      };
      source.onmessage = onEvent;
      source.addEventListener('ai-conversation', onEvent as EventListener);
      source.onerror = () => {
        source?.close();
        source = null;
        if (pollTimer === null) pollTimer = window.setInterval(poll, 2_500);
      };
    } catch {
      pollTimer = window.setInterval(poll, 2_500);
    }

    return () => {
      stopped = true;
      source?.close();
      if (pollTimer !== null) window.clearInterval(pollTimer);
    };
  }, [aiConversationRepository, conversationId, refresh]);

  // Композер рендерится вне этого хука, но кнопке «Стоп» нужен именно живой ран,
  // а не флаг `sending` (он гаснет сразу после POST, задолго до конца генерации).
  useEffect(() => {
    if (!conversationId) return;
    const active = messages.find((message) => message.role === 'assistant'
      && (message.status === 'queued' || message.status === 'running')
      && message.runId);
    publishAiActiveRun(conversationId, active?.runId ?? null);
    return () => publishAiActiveRun(conversationId, null);
  }, [conversationId, messages]);

  const send = useCallback(async (body: string, mode: 'chat' | 'studio_plan' = 'chat') => {
    if (!conversationId || !body.trim() || sending) return;
    const cleanBody = body.trim();
    const clientRequestId = createClientRequestId();
    const optimisticId = `optimistic:${clientRequestId}`;
    const optimisticAssistantId = `optimistic-assistant:${clientRequestId}`;
    const now = new Date().toISOString();
    setSending(true);
    setMessages((current) => [
      ...current,
      {
        id: optimisticId,
        conversationId,
        seq: `${Number.MAX_SAFE_INTEGER - 1}`,
        role: 'user',
        body: cleanBody,
        status: 'completed',
        runId: null,
        parentMessageId: null,
        clientRequestId,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: optimisticAssistantId,
        conversationId,
        seq: `${Number.MAX_SAFE_INTEGER}`,
        role: 'assistant',
        body: '',
        status: 'queued',
        runId: null,
        parentMessageId: optimisticId,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    try {
      const result = await aiConversationRepository.sendMessage(conversationId, {
        body: cleanBody,
        clientRequestId,
        mode,
        expectedConversationVersion: conversation?.version,
      });
      setConversation(result.conversation);
      setMessages((current) => mergeMessages(
        current.filter((message) => message.id !== optimisticId && message.id !== optimisticAssistantId),
        [result.userMessage, result.assistantMessage],
      ));
      setError(null);
      announceAiConversationsChanged();
    } catch (reason) {
      setMessages((current) => current.filter((message) => message.id !== optimisticId && message.id !== optimisticAssistantId));
      setError(reason instanceof Error ? reason.message : 'Не удалось отправить сообщение');
      throw reason;
    } finally {
      setSending(false);
    }
  }, [aiConversationRepository, conversation, conversationId, sending]);

  return { conversation, messages, loading, sending, error, refresh, send, setConversation };
}
