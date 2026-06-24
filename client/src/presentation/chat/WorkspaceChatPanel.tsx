import { useMemo, useState } from 'react';
import { MessagesSquare, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useChat } from '@/presentation/hooks/useChat';
import { useChatRooms } from '@/presentation/hooks/useChatRooms';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import { useCurrentWorkspace } from '@/presentation/hooks/useCurrentWorkspace';
import type { ChatMessage } from '@/domain/chat/ChatMessage';
import type { ChatRoom } from '@/domain/chat/ChatRoom';
import { ChatMessageList } from './ChatMessageList';
import { ChatComposer } from './ChatComposer';

// Чат в сайдбаре. Показывает комнаты, в которых юзер реально состоит (его дефолт-хаб со
// всеми проектами, хабы владельцев, куда его позвали, командные пространства), а НЕ только
// активное пространство — иначе приглашённый видел бы пустой собственный хаб вместо общего
// чата владельца. Если комнат несколько — переключатель сверху; если одна — просто заголовок.
export function WorkspaceChatPanel(): React.ReactElement {
  const { user } = useCurrentUser();
  const { workspace } = useCurrentWorkspace();
  const { rooms, loading: roomsLoading } = useChatRooms();
  const [pickedId, setPickedId] = useState<string | null>(null);

  // Выбранная комната: явный выбор юзера → активное пространство (если оно есть в списке) →
  // первая комната (самая свежая по последнему сообщению, сервер уже отсортировал).
  const selectedId = useMemo<string | null>(() => {
    if (pickedId && rooms.some((r) => r.workspaceId === pickedId)) return pickedId;
    if (workspace && rooms.some((r) => r.workspaceId === workspace.id)) return workspace.id;
    return rooms[0]?.workspaceId ?? null;
  }, [pickedId, rooms, workspace]);

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
      ) : rooms.length > 1 ? (
        <RoomSwitcher rooms={rooms} selectedId={selectedId} onSelect={setPickedId} />
      ) : (
        <div className="flex shrink-0 items-center gap-2 px-2 pb-2 text-sm font-medium">
          <MessagesSquare className="size-4 text-muted-foreground" />
          <span className="truncate">Чат · {selectedRoom?.name ?? workspace?.name ?? 'Пространство'}</span>
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

// Переключатель комнат (когда их >1): горизонтальный ряд «таблеток» с именем и точкой
// непрочитанного. Появляется у юзеров, состоящих в нескольких командах/хабах.
function RoomSwitcher({
  rooms,
  selectedId,
  onSelect,
}: {
  rooms: ChatRoom[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}): React.ReactElement {
  return (
    <div className="flex shrink-0 items-center gap-1 overflow-x-auto pb-2">
      {rooms.map((r) => {
        const active = r.workspaceId === selectedId;
        return (
          <button
            key={r.workspaceId}
            type="button"
            onClick={() => onSelect(r.workspaceId)}
            title={r.name}
            className={cn(
              'inline-flex max-w-[11rem] shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
              active
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'bg-muted text-muted-foreground hover:text-foreground',
            )}
          >
            <MessagesSquare className="size-3.5 shrink-0" />
            <span className="truncate">{r.name}</span>
            {r.unreadCount > 0 && (
              <span
                className={cn(
                  'inline-flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold',
                  active ? 'bg-primary-foreground/20' : 'bg-primary/15 text-primary',
                )}
              >
                {r.unreadCount > 99 ? '99+' : r.unreadCount}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
