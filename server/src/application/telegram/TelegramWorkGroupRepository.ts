// Рабочие Telegram-группы пространства (db/181). См.
// docs/superpowers/specs/2026-11-12-telegram-work-groups-design.md.

export type TelegramWorkGroup = {
  readonly chatId: number;
  readonly workspaceId: string;
  readonly title: string | null;
  readonly addedByUserId: string | null;
  readonly createdAt: Date;
};

// work — рабочая группа пространства; main — основная группа сводок (поле в карточке сводок).
export type TelegramGroupLinkPurpose = 'work' | 'main';

export type TelegramGroupLinkCode = {
  readonly workspaceId: string;
  readonly purpose: TelegramGroupLinkPurpose;
  readonly createdByUserId: string;
};

export interface TelegramWorkGroupRepository {
  listByWorkspace(workspaceId: string): Promise<TelegramWorkGroup[]>;
  findByChat(chatId: number): Promise<TelegramWorkGroup | null>;
  // 'exists' — группа уже рабочая (у этого или другого пространства, см. findByChat).
  insert(group: Omit<TelegramWorkGroup, 'createdAt'>): Promise<'created' | 'exists'>;
  updateTitle(chatId: number, title: string): Promise<void>;
  remove(workspaceId: string, chatId: number): Promise<boolean>;
  // Группа стала супергруппой и получила новый id: переносим рабочую группу, основную группу
  // сводок, группы сводок проектов, владельца группы и ждущие подключения людей.
  migrateChat(fromChatId: number, toChatId: number): Promise<void>;
  // Основная группа сводок пространства (workspace_assignee_digest_settings).
  getMainGroup(workspaceId: string): Promise<{ chatId: number; title: string | null } | null>;
  setMainGroup(workspaceId: string, chatId: number, title: string | null): Promise<void>;
  issueLinkCode(input: TelegramGroupLinkCode & { tokenHash: string; expiresAt: Date }): Promise<void>;
  // Атомарно гасит код. null — кода нет или он истёк.
  consumeLinkCode(tokenHash: string, now: Date): Promise<TelegramGroupLinkCode | null>;
}
