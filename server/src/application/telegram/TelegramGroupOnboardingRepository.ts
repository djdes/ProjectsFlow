// Подключение людей, написавших задачу в рабочей Telegram-группе (db/181). См.
// docs/superpowers/specs/2026-11-12-telegram-work-groups-design.md.

export type GroupOnboardingStatus = 'pending' | 'invited' | 'completed';

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

// connected — Telegram привязан к аккаунту; same — уже был привязан именно этот Telegram;
// conflict — у аккаунта другой Telegram или этот Telegram привязан к другому аккаунту.
export type TelegramLinkOutcome = 'connected' | 'same' | 'conflict';

export interface TelegramGroupOnboardingRepository {
  // Открытая (не завершённая и не истёкшая) запись человека в этой группе.
  findOpen(tgChatId: number, tgUserId: number, now: Date): Promise<GroupOnboarding | null>;
  getById(id: string): Promise<GroupOnboarding | null>;
  findByInvite(inviteId: string): Promise<GroupOnboarding | null>;
  create(onboarding: GroupOnboarding): Promise<void>;
  update(id: string, patch: GroupOnboardingPatch): Promise<void>;
  // Атомарно переводит в completed. false — запись уже завершена (повторное нажатие/принятие).
  claimCompletion(id: string): Promise<boolean>;
  // Привязка Telegram к аккаунту (как подтверждение pairing-ссылки, но без токена: личность
  // Telegram подтверждена личным /start у бота, ссылка ушла только в этот личный чат).
  linkTelegram(
    userId: string,
    telegram: { readonly id: number; readonly username: string | null; readonly firstName: string | null },
    now: Date,
  ): Promise<TelegramLinkOutcome>;
}
