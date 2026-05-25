import type { TelegramNotificationPrefs } from './TelegramNotificationPrefs.js';

// Привязка Telegram-аккаунта к юзеру projectsflow. Заполняется через Login Widget;
// tg_chat_id/tg_started_at — после первого /start юзера в @projectsflow_bot.
export type TelegramLink = {
  readonly telegramUserId: number;
  readonly telegramUsername: string | null;
  readonly telegramFirstName: string | null;
  readonly telegramPhotoUrl: string | null;
  readonly telegramAuthDate: Date | null;
  readonly tgChatId: number | null;
  readonly tgStartedAt: Date | null;
  readonly tgPairedAt: Date | null;
  readonly prefs: TelegramNotificationPrefs | null;
};

// Payload от Telegram Login Widget (https://core.telegram.org/widgets/login).
export type TelegramLoginWidgetPayload = {
  readonly id: number;
  readonly first_name?: string;
  readonly last_name?: string;
  readonly username?: string;
  readonly photo_url?: string;
  readonly auth_date: number; // unix seconds
  readonly hash: string;
};
