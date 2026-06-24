import { useState } from 'react';
import { MessagesSquare } from 'lucide-react';
import { useChat } from '@/presentation/hooks/useChat';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import { useCurrentWorkspace } from '@/presentation/hooks/useCurrentWorkspace';
import type { ChatMessage } from '@/domain/chat/ChatMessage';
import { ChatMessageList } from './ChatMessageList';
import { ChatComposer } from './ChatComposer';

// Чат активного пространства внутри сайдбара. Один общий канал для всех участников.
export function WorkspaceChatPanel(): React.ReactElement {
  const { user } = useCurrentUser();
  const { workspace } = useCurrentWorkspace();
  const workspaceId = workspace?.id ?? null;
  const chat = useChat(workspaceId);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);

  const canModerate = workspace?.role === 'owner';
  const currentUserId = user?.id ?? '';

  const handleSend = async (body: string, files: File[]): Promise<void> => {
    await chat.send(body, files, replyTo?.id ?? null);
    setReplyTo(null);
  };

  const handleSubmitEdit = async (body: string): Promise<void> => {
    if (!editing) return;
    await chat.edit(editing.id, body);
    setEditing(null);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-2 pb-2 text-sm font-medium">
        <MessagesSquare className="size-4 text-muted-foreground" />
        <span className="truncate">Чат · {workspace?.name ?? 'Пространство'}</span>
      </div>

      {chat.loading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Загрузка…
        </div>
      ) : chat.error ? (
        <div className="flex flex-1 items-center justify-center px-4 text-center text-sm text-destructive">
          Не удалось загрузить чат.
        </div>
      ) : chat.messages.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
          <MessagesSquare className="size-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            Пока нет сообщений. Напишите первым — это общий чат участников пространства.
          </p>
        </div>
      ) : (
        <ChatMessageList
          messages={chat.messages}
          currentUserId={currentUserId}
          canModerate={canModerate}
          hasMoreOlder={chat.hasMoreOlder}
          loadingOlder={chat.loadingOlder}
          loadOlder={chat.loadOlder}
          onReply={(m) => {
            setEditing(null);
            setReplyTo(m);
          }}
          onEdit={(m) => {
            setReplyTo(null);
            setEditing(m);
          }}
          onDelete={(m) => void chat.remove(m.id)}
          onToggleReaction={(id, emoji, mine) => void chat.toggleReaction(id, emoji, mine)}
          onReachedBottom={chat.markReadToNewest}
        />
      )}

      <ChatComposer
        onSend={handleSend}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        editing={editing}
        onSubmitEdit={handleSubmitEdit}
        onCancelEdit={() => setEditing(null)}
      />
    </div>
  );
}
