import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { UserRepository } from '../user/UserRepository.js';
import type { TelegramLoginWidgetPayload } from '../../domain/telegram/TelegramLink.js';

// Ошибки бизнес-валидации — каждая мапится в свой HTTP-код в errorHandler/route.
export class TelegramAuthInvalidHashError extends Error {
  constructor() {
    super('Telegram login hash mismatch');
    this.name = 'TelegramAuthInvalidHashError';
  }
}
export class TelegramAuthExpiredError extends Error {
  constructor() {
    super('Telegram login data expired (>24h)');
    this.name = 'TelegramAuthExpiredError';
  }
}
export class TelegramAlreadyLinkedError extends Error {
  constructor() {
    super('This Telegram account is already linked to another user');
    this.name = 'TelegramAlreadyLinkedError';
  }
}

type Deps = {
  readonly users: UserRepository;
  readonly botToken: string;
  // Сколько секунд считать payload Login Widget'а свежим. 24h по рекомендации Telegram.
  readonly maxAuthAgeSeconds: number;
};

// Привязка TG-аккаунта к юзеру projectsflow. Verify HMAC по
// https://core.telegram.org/widgets/login → проверка UNIQUE → сохранение link'а с
// дефолтными prefs (применяются при отсутствии записи в БД, см. resolveTgPref).
export class ConnectTelegramAccount {
  constructor(private readonly deps: Deps) {}

  async execute(userId: string, payload: TelegramLoginWidgetPayload): Promise<void> {
    this.verifyHash(payload);
    this.verifyFreshness(payload.auth_date);

    const existing = await this.deps.users.findUserIdByTelegramUserId(payload.id);
    if (existing && existing !== userId) {
      throw new TelegramAlreadyLinkedError();
    }

    await this.deps.users.saveTelegramLink(userId, {
      telegramUserId: payload.id,
      telegramUsername: payload.username ?? null,
      telegramFirstName: payload.first_name ?? null,
      telegramPhotoUrl: payload.photo_url ?? null,
      telegramAuthDate: new Date(payload.auth_date * 1000),
    });
  }

  private verifyHash(payload: TelegramLoginWidgetPayload): void {
    // Алгоритм: data_check_string = sorted key=value\n; secret = sha256(botToken);
    // HMAC-SHA256(secret, dataCheckString) === payload.hash.
    const { hash, ...rest } = payload;
    const dataCheckString = Object.keys(rest)
      .sort()
      .map((k) => `${k}=${(rest as Record<string, unknown>)[k]}`)
      .join('\n');
    const secret = createHash('sha256').update(this.deps.botToken).digest();
    const expected = createHmac('sha256', secret).update(dataCheckString).digest('hex');
    // Constant-time compare; разные длины — гарантированный mismatch.
    if (hash.length !== expected.length) throw new TelegramAuthInvalidHashError();
    const ok = timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(expected, 'hex'));
    if (!ok) throw new TelegramAuthInvalidHashError();
  }

  private verifyFreshness(authDateSeconds: number): void {
    const ageSec = Date.now() / 1000 - authDateSeconds;
    if (ageSec > this.deps.maxAuthAgeSeconds || ageSec < -300) {
      // Допустим небольшой clock-skew (-5 минут), но не «из будущего».
      throw new TelegramAuthExpiredError();
    }
  }
}
