// Зеркало серверного DTO. Все поля могут быть null когда юзер не привязал TG.
export type TelegramStatus = {
  readonly connected: boolean;
  readonly telegramUsername: string | null;
  readonly telegramFirstName: string | null;
  readonly telegramPhotoUrl: string | null;
  readonly tgStarted: boolean;
  readonly prefs: TelegramPrefs;
  readonly botUsername: string | null;
  readonly botDeepLink: string | null;
};

export type TelegramPrefs = {
  readonly commentOnMyTask: boolean;
  readonly mention: boolean;
  readonly statusChange: boolean;
  readonly ralphQuestion: boolean;
  readonly ralphAnswer: boolean;
  readonly taskDone: boolean;
};

// Payload от Telegram Login Widget callback (data-onauth). Имена полей в snake_case —
// так их формирует сам Telegram, не меняем.
export type TelegramLoginPayload = {
  readonly id: number;
  readonly first_name?: string;
  readonly last_name?: string;
  readonly username?: string;
  readonly photo_url?: string;
  readonly auth_date: number;
  readonly hash: string;
};

export interface TelegramRepository {
  getStatus(): Promise<TelegramStatus>;
  connect(payload: TelegramLoginPayload): Promise<TelegramStatus>;
  disconnect(): Promise<void>;
  updatePrefs(prefs: Partial<TelegramPrefs>): Promise<TelegramStatus>;
}
