import { useMemo, useState } from 'react';
import { MessagesSquare, Trash2, Users, X } from 'lucide-react';
import { useChat } from '@/presentation/hooks/useChat';
import { useChatRooms } from '@/presentation/hooks/useChatRooms';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import { useCurrentWorkspace } from '@/presentation/hooks/useCurrentWorkspace';
import type { ChatMessage } from '@/domain/chat/ChatMessage';
import { ChatMessageList } from './ChatMessageList';
import { ChatComposer } from './ChatComposer';

// Один общий чат активного пространства — НЕ список комнат/пространств. Участники = все люди
// по всем проектам этого пространства (для дефолт-хаба это все мои коллабораторы, для
// командного — люди его проектов; состав синкается на сервере). Сменил пространство — сменился
// и чат. Пространства в самом чате не показываем (как просил юзер).
//
// Привязка к АКТИВНОМУ пространству; но если активное пространство — пустой собственный хаб
// приглашённого (в списке чат-комнат его нет, т.к. там нет команды/сообщений), резолвим в
// первую доступную комнату — хаб владельца, где и лежит общий чат. Так приглашённый видит
// переписку, а не пустоту.
export function WorkspaceChatPanel(): React.ReactElement {
  const { user } = useCurrentUser();
  const { workspace } = useCurrentWorkspace();
  const { rooms, loading: roomsLoading } = useChatRooms();

  const selectedId = useMemo<string | null>(() => {
    if (workspace && rooms.some((r) => r.workspaceId === workspace.id)) return workspace.id;
    return rooms[0]?.workspaceId ?? null;
  }, [rooms, workspace]);

  const selectedRoom = rooms.find((r) => r.workspaceId === selectedId) ?? null;
  const chat = useChat(selectedId);

  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  // Множественное выделение (drag по области рядом с сообщениями) для массового удаления.
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());

  const canModerate = selectedRoom?.role === 'owner';
  const currentUserId = user?.id ?? '';

  const clearSelection = (): void => setSelectedIds(new Set());
  const handleBulkDelete = async (): Promise<void> => {
    const ids = [...selectedIds];
    clearSelection();
    await chat.removeMany(ids);
  };

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
      {selectedIds.size > 0 ? (
        // Бар массового действия: «N выбрано · Удалить · Отмена».
        <div className="flex shrink-0 items-center justify-between gap-2 px-2 pb-2 text-sm">
          <span className="font-medium">{selectedIds.size} выбрано</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => void handleBulkDelete()}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10"
            >
              <Trash2 className="size-3.5" />
              Удалить
            </button>
            <button
              type="button"
              onClick={clearSelection}
              aria-label="Отмена"
              className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      ) : (
        <div className="flex shrink-0 items-center gap-2 px-2 pb-2 text-sm font-medium">
          <MessagesSquare className="size-4 text-muted-foreground" />
          <span className="truncate">Чат</span>
          {selectedRoom && selectedRoom.memberCount > 1 && (
            <span className="ml-auto inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
              <Users className="size-3.5" />
              {selectedRoom.memberCount}
            </span>
          )}
        </div>
      )}

      {roomsLoading || chat.loading ? (
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
            Пока нет сообщений. Напишите первым — это общий чат участников.
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
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
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
