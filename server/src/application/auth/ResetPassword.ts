import type { PasswordHasher } from '../crypto/PasswordHasher.js';
import type { SessionRepository } from '../session/SessionRepository.js';
import type { UserRepository } from '../user/UserRepository.js';
import {
  PasswordResetTokenExpiredError,
  PasswordResetTokenInvalidError,
} from '../../domain/auth/passwordResetErrors.js';
import type { PasswordResetTokenRepository } from './PasswordResetTokenRepository.js';

type Deps = {
  readonly users: UserRepository;
  readonly tokens: PasswordResetTokenRepository;
  readonly sessions: SessionRepository;
  readonly passwordHasher: PasswordHasher;
  readonly now: () => Date;
};

// Минимальная длина нового пароля — как при регистрации.
const MIN_PASSWORD_LEN = 8;

// Установить новый пароль по токену из письма. Токен одноразовый (markUsed) и с TTL.
// После успеха инвалидируем ВСЕ сессии юзера — если сброс инициировал злоумышленник или
// аккаунт был скомпрометирован, старые сессии не должны пережить смену пароля.
export class ResetPassword {
  constructor(private readonly deps: Deps) {}

  async execute(token: string, newPassword: string): Promise<void> {
    if (newPassword.length < MIN_PASSWORD_LEN) {
      // Валидацию длины дублируем и на сервере (single source of truth — здесь).
      throw new PasswordResetTokenInvalidError();
    }
    const now = this.deps.now();
    const found = await this.deps.tokens.findValidByToken(token, now);
    if (!found) {
      // Не различаем «не найден» и «истёк/использован» для клиента детально: и то и другое —
      // «ссылка недействительна, запросите заново». Бросаем expired как более полезную формулировку.
      throw new PasswordResetTokenExpiredError();
    }

    const hash = await this.deps.passwordHasher.hash(newPassword);
    await this.deps.users.updatePasswordHash(found.userId, hash);
    await this.deps.tokens.markUsed(found.id, now);
    // Разлогиниваем везде — свежий пароль = чистый старт.
    await this.deps.sessions.deleteAllForUser(found.userId);
  }
}
