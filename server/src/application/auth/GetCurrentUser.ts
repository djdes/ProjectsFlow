import type { User } from '../../domain/user/User.js';
import type { UserRepository } from '../user/UserRepository.js';
import type { SessionRepository } from '../session/SessionRepository.js';

type Deps = {
  readonly users: UserRepository;
  readonly sessions: SessionRepository;
  readonly now: () => Date;
};

export class GetCurrentUser {
  constructor(private readonly deps: Deps) {}

  // Возвращает {user, session} если session-id валиден и не истёк, иначе null.
  // null означает «нужно перелогиниться» — presentation решает что делать (401 для API).
  async execute(sessionId: string): Promise<{ user: User; sessionId: string } | null> {
    const session = await this.deps.sessions.getById(sessionId);
    if (!session) return null;
    if (session.expiresAt.getTime() <= this.deps.now().getTime()) {
      // Истёкшую сессию подчищаем
      await this.deps.sessions.delete(session.id);
      return null;
    }
    const user = await this.deps.users.getById(session.userId);
    if (!user) {
      // Юзер удалён, сессия осиротела — чистим
      await this.deps.sessions.delete(session.id);
      return null;
    }
    return { user, sessionId: session.id };
  }
}
