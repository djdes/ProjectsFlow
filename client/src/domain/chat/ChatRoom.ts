import type { WorkspaceKind } from '@/domain/workspace/Workspace';

// Чат-комната в списке пользователя: пространство, где он участник (его дефолт-хаб, хаб
// владельца проекта, в который его позвали, или командное пространство) + непрочитанное.
// Источник правды — сервер (ChatService.listRooms): возвращает только комнаты с командой
// или сообщениями, поэтому пустой соло-хаб приглашённого сюда не попадает.
export type ChatRoom = {
  readonly workspaceId: string;
  readonly name: string;
  readonly kind: WorkspaceKind;
  readonly ownerUserId: string;
  // Роль текущего юзера в комнате — owner может модерировать (удалять) чужие сообщения.
  readonly role: 'owner' | 'editor' | 'viewer';
  readonly memberCount: number;
  readonly unreadCount: number;
  readonly lastMessageSeq: number;
};
