import { eq, inArray } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { users, type UserRow } from '../db/schema.js';
import type { User, UserWithSecrets } from '../../domain/user/User.js';
import type {
  CreateUserInput,
  TelegramLinkInput,
  UpdateProfileInput,
  UserRepository,
} from '../../application/user/UserRepository.js';
import type { TelegramLink } from '../../domain/telegram/TelegramLink.js';
import type { TelegramNotificationPrefs } from '../../domain/telegram/TelegramNotificationPrefs.js';

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl ?? null,
    isAdmin: row.isAdmin,
    createdAt: row.createdAt,
  };
}

function toUserWithSecrets(row: UserRow): UserWithSecrets {
  return {
    ...toUser(row),
    passwordHash: row.passwordHash,
  };
}

export class DrizzleUserRepository implements UserRepository {
  constructor(private readonly db: Database) {}

  async getById(id: string): Promise<User | null> {
    const rows = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    const row = rows[0];
    return row ? toUser(row) : null;
  }

  async getByEmail(email: string): Promise<UserWithSecrets | null> {
    const rows = await this.db
      .select()
      .from(users)
      .where(eq(users.email, email.toLowerCase()))
      .limit(1);
    const row = rows[0];
    return row ? toUserWithSecrets(row) : null;
  }

  async create(input: CreateUserInput): Promise<User> {
    await this.db.insert(users).values({
      id: input.id,
      email: input.email.toLowerCase(),
      passwordHash: input.passwordHash,
      displayName: input.displayName,
      avatarUrl: null,
    });
    // Читаем обратно, чтобы взять реальный createdAt из БД
    const fresh = await this.getById(input.id);
    if (!fresh) throw new Error('Failed to read back user after insert');
    return fresh;
  }

  async updateProfile(id: string, input: UpdateProfileInput): Promise<User> {
    await this.db
      .update(users)
      .set({
        displayName: input.displayName,
        email: input.email.toLowerCase(),
      })
      .where(eq(users.id, id));
    const updated = await this.getById(id);
    if (!updated) throw new Error('User disappeared during updateProfile');
    return updated;
  }

  async getManyByIds(ids: readonly string[]): Promise<User[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select()
      .from(users)
      .where(inArray(users.id, [...ids]));
    return rows.map(toUser);
  }

  async listAdmins(): Promise<User[]> {
    const rows = await this.db.select().from(users).where(eq(users.isAdmin, true));
    return rows.map(toUser);
  }

  // ===== Telegram =====

  async getTelegramLink(userId: string): Promise<TelegramLink | null> {
    const rows = await this.db
      .select({
        telegramUserId: users.telegramUserId,
        telegramUsername: users.telegramUsername,
        telegramFirstName: users.telegramFirstName,
        telegramPhotoUrl: users.telegramPhotoUrl,
        telegramAuthDate: users.telegramAuthDate,
        tgChatId: users.tgChatId,
        tgStartedAt: users.tgStartedAt,
        tgPairedAt: users.tgPairedAt,
        tgNotificationPrefs: users.tgNotificationPrefs,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const r = rows[0];
    if (!r || r.telegramUserId === null) return null;
    return {
      telegramUserId: r.telegramUserId,
      telegramUsername: r.telegramUsername ?? null,
      telegramFirstName: r.telegramFirstName ?? null,
      telegramPhotoUrl: r.telegramPhotoUrl ?? null,
      telegramAuthDate: r.telegramAuthDate ?? null,
      tgChatId: r.tgChatId ?? null,
      tgStartedAt: r.tgStartedAt ?? null,
      tgPairedAt: r.tgPairedAt ?? null,
      prefs: r.tgNotificationPrefs ?? null,
    };
  }

  async findUserIdByTelegramUserId(telegramUserId: number): Promise<string | null> {
    const rows = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.telegramUserId, telegramUserId))
      .limit(1);
    return rows[0]?.id ?? null;
  }

  async saveTelegramLink(userId: string, input: TelegramLinkInput): Promise<void> {
    await this.db
      .update(users)
      .set({
        telegramUserId: input.telegramUserId,
        telegramUsername: input.telegramUsername,
        telegramFirstName: input.telegramFirstName,
        telegramPhotoUrl: input.telegramPhotoUrl,
        telegramAuthDate: input.telegramAuthDate,
        tgPairedAt: new Date(),
        // tg_chat_id и tg_started_at НЕ трогаем — приходят из webhook /start.
      })
      .where(eq(users.id, userId));
  }

  async clearTelegramLink(userId: string): Promise<void> {
    await this.db
      .update(users)
      .set({
        telegramUserId: null,
        telegramUsername: null,
        telegramFirstName: null,
        telegramPhotoUrl: null,
        telegramAuthDate: null,
        tgChatId: null,
        tgStartedAt: null,
        tgPairedAt: null,
        tgNotificationPrefs: null,
      })
      .where(eq(users.id, userId));
  }

  async updateTelegramPrefs(
    userId: string,
    prefs: TelegramNotificationPrefs,
  ): Promise<void> {
    // Merge с существующими через read-then-write. Атомарность не критична — это user-
    // preferences, конкурентный write такой же юзер делает только из одной вкладки.
    const current = await this.getTelegramLink(userId);
    const merged = { ...(current?.prefs ?? {}), ...prefs };
    await this.db
      .update(users)
      .set({ tgNotificationPrefs: merged })
      .where(eq(users.id, userId));
  }

  async markTelegramStarted(userId: string, chatId: number): Promise<void> {
    await this.db
      .update(users)
      .set({ tgChatId: chatId, tgStartedAt: new Date() })
      .where(eq(users.id, userId));
  }

  async clearTelegramStarted(userId: string): Promise<void> {
    await this.db
      .update(users)
      .set({ tgStartedAt: null })
      .where(eq(users.id, userId));
  }
}
