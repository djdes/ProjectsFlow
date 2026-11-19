import type { User } from '../../domain/user/User.js';
import type { UserRepository } from '../user/UserRepository.js';
import type { SessionRepository } from '../session/SessionRepository.js';
import type { LastSeenTracker } from './LastSeenTracker.js';

type Deps = {
  readonly users: UserRepository;
  readonly sessions: SessionRepository;
  readonly now: () => Date;
  // Marks the user as active (admin users console). A session «от имени» does not count.
  readonly lastSeen?: LastSeenTracker;
};

export class GetCurrentUser {
  constructor(private readonly deps: Deps) {}

  // Возвращает {user, session} если session-id валиден и не истёк, иначе null.
  // null означает «нужно перелогиниться» — presentation решает что делать (401 для API).
  // impersonatedBy — администратор, вошедший от имени пользователя (см. Impersonation).
  async execute(
    sessionId: string,
  ): Promise<{ user: User; sessionId: string; impersonatedBy: { id: string; displayName: string } | null } | null> {
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
    if (!session.impersonatorSessionId) {
      this.deps.lastSeen?.touch(user.id, this.deps.now());
      return { user, sessionId: session.id, impersonatedBy: null };
    }
    // Вход «от имени» живёт, только пока жива сессия администратора и он всё ещё администратор:
    // иначе по забытой вкладке можно было бы остаться в чужой учётной записи.
    const adminSession = await this.deps.sessions.getById(session.impersonatorSessionId);
    const admin =
      adminSession && adminSession.expiresAt.getTime() > this.deps.now().getTime()
        ? await this.deps.users.getById(adminSession.userId)
        : null;
    if (!admin?.isAdmin) {
      await this.deps.sessions.delete(session.id);
      return null;
    }
    return { user, sessionId: session.id, impersonatedBy: { id: admin.id, displayName: admin.displayName } };
  }
}
