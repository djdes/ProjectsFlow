import type { EmailSender } from '../notifications/EmailSender.js';
import type { UserRepository } from '../user/UserRepository.js';
import type { PasswordResetTokenRepository } from './PasswordResetTokenRepository.js';
import { renderPasswordResetEmail } from './emails/passwordResetEmail.js';

type Deps = {
  readonly users: UserRepository;
  readonly tokens: PasswordResetTokenRepository;
  readonly email: EmailSender;
  readonly idGen: () => string;
  readonly now: () => Date;
  // Срок жизни ссылки сброса (мс). Дефолт — 1 час.
  readonly ttlMs: number;
  // Базовый URL приложения для сборки ссылки {appUrl}/reset-password?token=...
  readonly appUrl: string;
};

// Запрос сброса пароля по email. ВСЕГДА завершается успешно (void) — не раскрываем,
// существует ли аккаунт (anti-enumeration). Если юзер есть: инвалидируем прежние токены,
// создаём новый, шлём письмо со ссылкой. Отправка письма — best-effort (не роняем ответ).
export class RequestPasswordReset {
  constructor(private readonly deps: Deps) {}

  async execute(rawEmail: string): Promise<void> {
    const email = rawEmail.trim().toLowerCase();
    const user = await this.deps.users.getByEmail(email);
    if (!user) return; // тихо — не раскрываем существование аккаунта

    // Один активный токен на юзера: прежние гасим.
    await this.deps.tokens.deleteAllForUser(user.id);

    // 2 uuid без дефисов = 64 hex-символа энтропии.
    const token = `${this.deps.idGen()}${this.deps.idGen()}`.replace(/-/g, '');
    const expiresAt = new Date(this.deps.now().getTime() + this.deps.ttlMs);
    await this.deps.tokens.create({ id: this.deps.idGen(), userId: user.id, token, expiresAt });

    const base = this.deps.appUrl.replace(/\/$/, '');
    const resetUrl = `${base}/reset-password?token=${encodeURIComponent(token)}`;
    const msg = renderPasswordResetEmail({
      to: user.email,
      resetUrl,
      ttlMinutes: Math.round(this.deps.ttlMs / 60000),
    });
    try {
      await this.deps.email.send(msg);
    } catch {
      // Письмо не ушло — не раскрываем это наружу (тот же void-ответ). Логи — на уровне sender'а.
    }
  }
}
