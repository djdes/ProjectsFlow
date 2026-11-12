// Подключение людей, написавших задачу в рабочей Telegram-группе (db/181). См.
// docs/superpowers/specs/2026-11-12-telegram-work-groups-design.md.

// cancelled — группу отключили или перенесли в другое пространство: подключение закрыто.
export type GroupOnboardingStatus = 'pending' | 'invited' | 'completed' | 'cancelled';

export type GroupOnboarding = {
  // 12 символов base64url: id уходит в deep link t.me/<bot>?start=wj_<id>.
  readonly id: string;
  readonly tgChatId: number;
  readonly workspaceId: string;
  readonly tgUserId: number;
  readonly tgUsername: string | null;
  readonly tgFirstName: string | null;
  readonly senderName: string;
  readonly groupTitle: string | null;
  // Сообщения, ждущие подключения (несколько — через пустую строку).
  readonly pendingText: string | null;
  readonly lastSourceKey: string | null;
  readonly status: GroupOnboardingStatus;
  readonly inviteId: string | null;
  readonly promptedAt: Date | null;
  readonly expiresAt: Date;
};

export type GroupOnboardingPatch = Partial<
  Pick<
    GroupOnboarding,
    | 'workspaceId'
    | 'tgUsername'
    | 'tgFirstName'
    | 'senderName'
    | 'groupTitle'
    | 'pendingText'
    | 'lastSourceKey'
    | 'status'
    | 'inviteId'
    | 'promptedAt'
    | 'expiresAt'
  >
>;

export interface TelegramGroupOnboardingRepository {
  // Открытая (pending/invited, не истёкшая) запись человека в этой группе.
  findOpen(tgChatId: number, tgUserId: number, now: Date): Promise<GroupOnboarding | null>;
  // Все открытые записи человека — после привязки Telegram создаём ждущие задачи.
  listOpenForTelegramUser(tgUserId: number, now: Date): Promise<GroupOnboarding[]>;
  getById(id: string): Promise<GroupOnboarding | null>;
  findByInvite(inviteId: string): Promise<GroupOnboarding | null>;
  create(onboarding: GroupOnboarding): Promise<void>;
  update(id: string, patch: GroupOnboardingPatch): Promise<void>;
  // Атомарно ставит приглашение, если его ещё нет (двойной Start в личке не плодит приглашения).
  // Возвращает приглашение записи после операции.
  setInviteIfAbsent(id: string, inviteId: string): Promise<string | null>;
  // Атомарно переводит в completed. false — запись уже закрыта (повторное нажатие/принятие).
  claimCompletion(id: string): Promise<boolean>;
  // Группу отключили: открытые записи → cancelled. Возвращает их приглашения (отозвать).
  cancelOpenForGroup(workspaceId: string, tgChatId: number): Promise<string[]>;
}
