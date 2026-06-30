import type { UserRepository } from '../user/UserRepository.js';
import { getAllTgPrefsResolved } from '../../domain/telegram/TelegramNotificationPrefs.js';
import type { TelegramNotifKind } from '../../domain/telegram/TelegramNotificationPrefs.js';

export type TelegramStatusDto = {
  readonly connected: boolean;
  readonly telegramUsername: string | null;
  readonly telegramFirstName: string | null;
  readonly telegramPhotoUrl: string | null;
  readonly tgStarted: boolean;
  readonly prefs: Record<TelegramNotifKind, boolean>;
  readonly botUsername: string | null;
  readonly botDeepLink: string | null;
  // Числовой id бота (часть токена до «:»). Публичен (его и так знает Login Widget) —
  // нужен фронту для кастомной кнопки через window.Telegram.Login.auth({ bot_id }).
  readonly botId: string | null;
};

type Deps = {
  readonly users: UserRepository;
  readonly botUsername: string | null;
  readonly botId: string | null;
};

export class GetTelegramStatus {
  constructor(private readonly deps: Deps) {}

  async execute(userId: string): Promise<TelegramStatusDto> {
    const link = await this.deps.users.getTelegramLink(userId);
    const botUsername = this.deps.botUsername;
    const botId = this.deps.botId;
    const botDeepLink = botUsername ? `https://t.me/${botUsername}?start=ready` : null;
    if (!link) {
      return {
        connected: false,
        telegramUsername: null,
        telegramFirstName: null,
        telegramPhotoUrl: null,
        tgStarted: false,
        prefs: getAllTgPrefsResolved(null),
        botUsername,
        botDeepLink,
        botId,
      };
    }
    return {
      connected: true,
      telegramUsername: link.telegramUsername,
      telegramFirstName: link.telegramFirstName,
      telegramPhotoUrl: link.telegramPhotoUrl,
      tgStarted: link.tgStartedAt !== null,
      prefs: getAllTgPrefsResolved(link.prefs),
      botUsername,
      botDeepLink,
      botId,
    };
  }
}
