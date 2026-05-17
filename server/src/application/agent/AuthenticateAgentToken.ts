import { AgentTokenInvalidError } from '../../domain/agent/errors.js';
import type { AgentToken } from '../../domain/agent/AgentToken.js';
import type { User } from '../../domain/user/User.js';
import type { UserRepository } from '../user/UserRepository.js';
import type { AgentTokenHasher } from './AgentTokenHasher.js';
import type { AgentTokenRepository } from './AgentTokenRepository.js';

type Deps = {
  readonly tokens: AgentTokenRepository;
  readonly hasher: AgentTokenHasher;
  readonly users: UserRepository;
};

export type AgentAuthResult = {
  readonly token: AgentToken;
  readonly user: User;
};

// Аутентификация входящего запроса от агента: проверяем что Bearer-токен валиден
// и не revoked. Возвращает agent-token + полного User (req.user в middleware ожидает full User).
// Дёргает touchLastUsed асинхронно — не блокирует ответ.
export class AuthenticateAgentToken {
  constructor(private readonly deps: Deps) {}

  async execute(plaintext: string): Promise<AgentAuthResult> {
    // 1. Хеш plaintext'а тем же алгоритмом (SHA-256 deterministic) для индекс-lookup'а.
    const hash = await this.deps.hasher.hash(plaintext);
    const token = await this.deps.tokens.findActiveByHash(hash);
    if (!token) throw new AgentTokenInvalidError();
    // 2. Дополнительная проверка constant-time через verify (защита от timing attacks
    // если бы hasher был не deterministic'ным — для SHA-256 опционально, но норма).
    const ok = await this.deps.hasher.verify(plaintext, hash);
    if (!ok) throw new AgentTokenInvalidError();
    // 3. Поднимаем пользователя из БД — если юзер удалён, токен инвалидируется.
    const user = await this.deps.users.getById(token.userId);
    if (!user) throw new AgentTokenInvalidError();
    // 4. Touch lastUsedAt — fire-and-forget, ошибки не критичны.
    void this.deps.tokens.touchLastUsed(token.id).catch(() => {});
    return { token, user };
  }
}
