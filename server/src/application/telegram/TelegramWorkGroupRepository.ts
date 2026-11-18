// Рабочие Telegram-группы пространства (db/181). См.
// docs/superpowers/specs/2026-11-12-telegram-work-groups-design.md.

// draft — бот сам добавил группу, ждёт подтверждения (ничего не открывает); active — рабочая;
// disconnected — бота удалили из группы (db/189).
export type TelegramWorkGroupStatus = 'draft' | 'active' | 'disconnected';

// standard — обычная рабочая группа; incident — замена CSharpFixer-чата: писать может любой,
// задача ставится в проект группы молча (ralphMode=silent, runMode=full), результат — reply
// простым языком в группу (spec 2026-11-17, раздел 3).
export type TelegramWorkGroupMode = 'standard' | 'incident';

export type TelegramWorkGroup = {
  readonly chatId: number;
  readonly workspaceId: string;
  readonly title: string | null;
  readonly addedByUserId: string | null;
  readonly createdAt: Date;
  readonly status: TelegramWorkGroupStatus;
  // Нет значения — standard (группы до db/189 и фейки тестов).
  readonly mode?: TelegramWorkGroupMode;
  readonly invitedByTgUserId: number | null;
  // Проекты группы (db/189). Пусто — все проекты пространства.
  readonly projectIds: readonly string[];
  // Запрос другого пространства забрать отключённую группу (db/189). Ждёт одобрения владельца
  // текущего пространства группы; до этого группа остаётся за ним.
  readonly transfer?: TelegramGroupTransfer | null;
};

export type TelegramGroupTransfer = {
  readonly toWorkspaceId: string;
  readonly requestedByUserId: string;
  // Каким группа станет в новом пространстве: active — подключение кодом/по id, draft — бот добавлен.
  readonly targetStatus: 'draft' | 'active';
  readonly requestedAt: Date;
};

export type NewTelegramWorkGroup = {
  readonly chatId: number;
  readonly workspaceId: string;
  readonly title: string | null;
  readonly addedByUserId: string | null;
  // По умолчанию active (подключение кодом или вручную).
  readonly status?: TelegramWorkGroupStatus;
  readonly invitedByTgUserId?: number | null;
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
  insert(group: NewTelegramWorkGroup): Promise<'created' | 'exists'>;
  // Перезаписать существующую строку (черновик/отключённая группа снова подключается или
  // снова становится черновиком): пространство, статус, кто добавил. Проекты сбрасываются,
  // если пространство сменилось; запрос на перенос снимается.
  replace(group: NewTelegramWorkGroup): Promise<void>;
  // Запрос на перенос отключённой группы в другое пространство (новый заменяет прежний).
  requestTransfer(chatId: number, transfer: Omit<TelegramGroupTransfer, 'requestedAt'>): Promise<void>;
  clearTransfer(chatId: number): Promise<void>;
  setStatus(chatId: number, status: TelegramWorkGroupStatus): Promise<void>;
  setMode(chatId: number, mode: TelegramWorkGroupMode): Promise<void>;
  // Проекты группы заменяются целиком (db/189).
  setProjects(chatId: number, projectIds: readonly string[], actorUserId: string): Promise<void>;
  // Проекты активной группы, ещё лежащие в её пространстве. Пусто — ограничения нет.
  listActiveProjectIds(chatId: number): Promise<string[]>;
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
