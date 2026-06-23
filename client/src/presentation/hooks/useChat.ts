import { useCallback, useEffect, useRef, useState } from 'react';
import { useContainer } from '@/infrastructure/di/container';
import type { ChatMessage, ChatReactionAggregate } from '@/domain/chat/ChatMessage';

const PAGE = 40;

// SSE-событие чата (wire). createdAt/editedAt — ISO; конвертируем при мердже.
type ChatStreamEventWire =
  | { kind: 'message_added'; message: RawMessage }
  | { kind: 'message_edited'; message: RawMessage }
  | { kind: 'message_deleted'; messageId: string; seq: number }
  | { kind: 'reaction_changed'; messageId: string; reactions: ChatReactionAggregate[] };

type RawMessage = Omit<ChatMessage, 'createdAt' | 'editedAt' | 'attachments'> & {
  createdAt: string;
  editedAt: string | null;
  attachments: Array<Omit<ChatMessage['attachments'][number], 'url'>>;
};

function upsert(list: ChatMessage[], msg: ChatMessage): ChatMessage[] {
  const i = list.findIndex((m) => m.id === msg.id);
  if (i >= 0) {
    const next = list.slice();
    next[i] = msg;
    return next;
  }
  const next = [...list, msg];
  next.sort((a, b) => a.seq - b.seq);
  return next;
}

export type UseChatResult = {
  messages: ChatMessage[];
  loading: boolean;
  error: Error | null;
  hasMoreOlder: boolean;
  loadingOlder: boolean;
  loadOlder: () => void;
  send: (body: string, files?: File[]) => Promise<void>;
  edit: (messageId: string, body: string) => Promise<void>;
  remove: (messageId: string) => Promise<void>;
  toggleReaction: (messageId: string, emoji: string, reactedByMe: boolean) => Promise<void>;
  markReadToNewest: () => void;
};

// Управляет лентой чата активного пространства: начальная страница (REST) + подгрузка вверх
// + live-merge из SSE. Дедуп по message.id (SSE-эхо собственных сообщений не двоит).
export function useChat(workspaceId: string | null): UseChatResult {
  const { chatRepository } = useContainer();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [hasMoreOlder, setHasMoreOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const messagesRef = useRef<ChatMessage[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Начальная загрузка + переинициализация при смене пространства.
  useEffect(() => {
    if (!workspaceId) {
      setMessages([]);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    chatRepository
      .listMessages(workspaceId, { limit: PAGE })
      .then((page) => {
        if (!alive) return;
        setMessages(page);
        setHasMoreOlder(page.length >= PAGE);
        setLoading(false);
      })
      .catch((e: Error) => {
        if (!alive) return;
        setError(e);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [workspaceId, chatRepository]);

  // SSE live-merge. afterSeq фиксируем на момент открытия; дедуп по id разрулит повторы.
  useEffect(() => {
    if (!workspaceId) return;
    const afterSeq = messagesRef.current.at(-1)?.seq ?? 0;
    const source = new EventSource(chatRepository.streamUrl(workspaceId, afterSeq), {
      withCredentials: true,
    });
    source.addEventListener('chat', (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data) as ChatStreamEventWire;
        if (data.kind === 'message_added' || data.kind === 'message_edited') {
          const m = data.message;
          const msg: ChatMessage = {
            ...m,
            createdAt: new Date(m.createdAt),
            editedAt: m.editedAt ? new Date(m.editedAt) : null,
            attachments: m.attachments.map((a) => ({
              ...a,
              url: chatRepository.attachmentUrl(workspaceId, a.id),
            })),
          };
          setMessages((prev) => upsert(prev, msg));
        } else if (data.kind === 'message_deleted') {
          setMessages((prev) =>
            prev.map((x) =>
              x.id === data.messageId
                ? { ...x, deleted: true, body: '', reactions: [], attachments: [] }
                : x,
            ),
          );
        } else if (data.kind === 'reaction_changed') {
          setMessages((prev) =>
            prev.map((x) => (x.id === data.messageId ? { ...x, reactions: data.reactions } : x)),
          );
        }
      } catch {
        // битый payload — игнорируем.
      }
    });
    return () => source.close();
  }, [workspaceId, chatRepository]);

  const loadOlder = useCallback(() => {
    if (!workspaceId || loadingOlder) return;
    const oldest = messagesRef.current[0]?.seq;
    if (oldest === undefined) return;
    setLoadingOlder(true);
    chatRepository
      .listMessages(workspaceId, { beforeSeq: oldest, limit: PAGE })
      .then((older) => {
        setMessages((prev) => {
          const ids = new Set(prev.map((m) => m.id));
          const merged = [...older.filter((m) => !ids.has(m.id)), ...prev];
          merged.sort((a, b) => a.seq - b.seq);
          return merged;
        });
        setHasMoreOlder(older.length >= PAGE);
      })
      .catch(() => {})
      .finally(() => setLoadingOlder(false));
  }, [workspaceId, chatRepository, loadingOlder]);

  const send = useCallback(
    async (body: string, files?: File[]) => {
      if (!workspaceId) return;
      const msg = await chatRepository.sendMessage(workspaceId, { body, files });
      setMessages((prev) => upsert(prev, msg));
    },
    [workspaceId, chatRepository],
  );

  const edit = useCallback(
    async (messageId: string, body: string) => {
      if (!workspaceId) return;
      const msg = await chatRepository.editMessage(workspaceId, messageId, body);
      setMessages((prev) => upsert(prev, msg));
    },
    [workspaceId, chatRepository],
  );

  const remove = useCallback(
    async (messageId: string) => {
      if (!workspaceId) return;
      await chatRepository.deleteMessage(workspaceId, messageId);
      setMessages((prev) =>
        prev.map((x) =>
          x.id === messageId ? { ...x, deleted: true, body: '', reactions: [], attachments: [] } : x,
        ),
      );
    },
    [workspaceId, chatRepository],
  );

  const toggleReaction = useCallback(
    async (messageId: string, emoji: string, reactedByMe: boolean) => {
      if (!workspaceId) return;
      if (reactedByMe) await chatRepository.removeReaction(workspaceId, messageId, emoji);
      else await chatRepository.addReaction(workspaceId, messageId, emoji);
    },
    [workspaceId, chatRepository],
  );

  const markReadToNewest = useCallback(() => {
    if (!workspaceId) return;
    const newest = messagesRef.current.at(-1)?.seq;
    if (newest === undefined) return;
    void chatRepository.markRead(workspaceId, newest).catch(() => {});
  }, [workspaceId, chatRepository]);

  return {
    messages,
    loading,
    error,
    hasMoreOlder,
    loadingOlder,
    loadOlder,
    send,
    edit,
    remove,
    toggleReaction,
    markReadToNewest,
  };
}
