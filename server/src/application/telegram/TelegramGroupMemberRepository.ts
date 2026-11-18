// Участники рабочих Telegram-групп (db/191). См. spec 2026-11-17, §4.

export type TelegramGroupMemberStatus = 'member' | 'admin' | 'left';
// admins — снимок getChatAdministrators; join — chat_member / вступление; message — автор сообщения.
export type TelegramGroupMemberSource = 'admins' | 'join' | 'message';

export type TelegramGroupMemberSighting = {
  readonly chatId: number;
  readonly tgUserId: number;
  readonly source: TelegramGroupMemberSource;
  // Статус из события. Для автора сообщения не задаётся: известно лишь, что он в группе —
  // администратор остаётся администратором, вышедший снова становится участником.
  readonly status?: TelegramGroupMemberStatus;
  readonly seenAt: Date;
};

// Участник группы, чей Telegram привязан к аккаунту PF.
export type LinkedTelegramGroupMember = {
  readonly tgUserId: number;
  readonly userId: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly status: Exclude<TelegramGroupMemberStatus, 'left'>;
};

export interface TelegramGroupMemberRepository {
  upsert(sighting: TelegramGroupMemberSighting): Promise<void>;
  // Сколько участников в группе (кроме вышедших) и кто из них связан с PF.
  summary(chatId: number): Promise<{ readonly telegramCount: number; readonly linked: LinkedTelegramGroupMember[] }>;
}
