import type { AgentToken } from '../../domain/agent/AgentToken.js';
import type { GithubConnectionWithToken } from '../../domain/github/GithubConnection.js';
import type { User } from '../../domain/user/User.js';
import type { UserRepository } from '../user/UserRepository.js';
import type { GithubTokenRepository } from '../github/GithubTokenRepository.js';
import type { AgentTokenRepository } from './AgentTokenRepository.js';

type Deps = {
  readonly users: UserRepository;
  readonly githubTokens: GithubTokenRepository;
  readonly agentTokens: AgentTokenRepository;
};

export type MyAccount = {
  readonly user: User;
  readonly github: GithubConnectionWithToken | null;
  readonly agentTokens: readonly AgentToken[];
};

// Возвращает «всё про текущего юзера, что у нас есть». Используется только из
// agent-API (pf_get_my_account) — вызов уже идёт через Bearer-токен этого же
// юзера, т.е. подтверждённая авторизация на свои собственные данные.
//
// Что включаем и почему:
//   - User (профиль): email, displayName, isAdmin и т.д.
//   - GitHub connection С access-token'ом (`accessToken` в plaintext). Обычно
//     этот токен НЕ утекает за presentation (см. комментарий в GithubConnection.ts),
//     но здесь — исключение по явному запросу юзера на свои собственные данные:
//     симметрично с pf_get_credential, который возвращает plaintext секретов
//     самого юзера. Если потребуется ужесточить — добавить opt-in флаг.
//   - Agent-токены: метаданные (id, name, createdAt, lastUsedAt). Plaintext
//     значения токенов не возвращаем — у нас только bcrypt-хэш, plaintext
//     существует ровно на момент создания и больше нигде.
//
// Чего НЕ возвращаем и почему:
//   - Пароль аккаунта: хранится как bcrypt-хэш, восстановить невозможно
//     (presentation отдаст `passwordHashed: true` как явное пояснение).
export class GetMyAccount {
  constructor(private readonly deps: Deps) {}

  async execute(userId: string): Promise<MyAccount> {
    const user = await this.deps.users.getById(userId);
    if (!user) {
      // Не должно случиться: токен уже отвалидирован, юзер был. Но защищаемся.
      throw new Error('user_not_found');
    }
    const github = await this.deps.githubTokens.getWithTokenByUserId(userId);
    const agentTokens = await this.deps.agentTokens.listByUser(userId);
    return { user, github, agentTokens };
  }
}
