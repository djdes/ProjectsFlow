import type { User, UserWithSecrets } from '../../domain/user/User.js';
import type { TelegramLink } from '../../domain/telegram/TelegramLink.js';
import type { TelegramNotificationPrefs } from '../../domain/telegram/TelegramNotificationPrefs.js';
import type { NotificationPrefs } from '../../domain/notifications/NotificationPrefs.js';

// Поля, приходящие из Login Widget — сохраняются как есть. tg_chat_id/tg_started_at
// заполняются позже из webhook'а /start.
export type TelegramLinkInput = {
  readonly telegramUserId: number;
  readonly telegramUsername: string | null;
  readonly telegramFirstName: string | null;
  readonly telegramPhotoUrl: string | null;
  readonly telegramAuthDate: Date;
};

export type CreateUserInput = {
  readonly id: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly displayName: string;
};

export type UpdateProfileInput = {
  readonly displayName: string;
  readonly email: string;
};

export interface UserRepository {
  getById(id: string): Promise<User | null>;
  getByEmail(email: string): Promise<UserWithSecrets | null>;
  // Батч для админ-страниц / dispatcher-кандидатов: id'шки → users (без секретов).
  // Сортировка не гарантирована — caller сам упорядочит при нужде.
  getManyByIds(ids: readonly string[]): Promise<User[]>;
  // Все юзеры с isAdmin=true. Используется для расширения dispatcher-candidates:
  // админы — валидные диспетчеры в любом проекте (admin-bypass даёт им access).
  listAdmins(): Promise<User[]>;
  create(input: CreateUserInput): Promise<User>;
  updateProfile(id: string, input: UpdateProfileInput): Promise<User>;

  // Telegram-привязка. Все методы opt-in: если юзер не использует TG — никогда не зовутся.
  getTelegramLink(userId: string): Promise<TelegramLink | null>;
  // Батч: возвращает set userIds которые имеют привязку TG. Один SELECT вместо N.
  // Используется для hasTelegram-флага в /members и при taskId fan-out'е.
  findUsersWithTelegram(userIds: readonly string[]): Promise<Set<string>>;
  // Для verify/connect: проверка что этот telegram_user_id ещё не привязан к другому юзеру.
  findUserIdByTelegramUserId(telegramUserId: number): Promise<string | null>;
  // Полный upsert привязки (после verify Login Widget). НЕ затрагивает prefs и
  // tg_chat_id/tg_started_at (те ставятся отдельно через webhook /start).
  saveTelegramLink(userId: string, input: TelegramLinkInput): Promise<void>;
  // Очистка всех telegram_* колонок (юзер нажал Disconnect).
  clearTelegramLink(userId: string): Promise<void>;
  // Merge новых prefs с существующими (Partial-обновление).
  updateTelegramPrefs(userId: string, prefs: TelegramNotificationPrefs): Promise<void>;
  // Webhook /start: помечаем что юзер открыл чат и кэшируем chat_id.
  markTelegramStarted(userId: string, chatId: number): Promise<void>;
  // 403 от sendMessage (bot blocked / user not started): сбрасываем tg_started_at,
  // чтобы UI показал «нужно нажать Start снова».
  clearTelegramStarted(userId: string): Promise<void>;

  // Глобальные дефолтные email-notification prefs (NULL = системные дефолты).
  getDefaultNotificationPrefs(userId: string): Promise<NotificationPrefs | null>;
  setDefaultNotificationPrefs(userId: string, prefs: NotificationPrefs): Promise<void>;
}
