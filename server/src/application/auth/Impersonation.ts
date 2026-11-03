import type { User } from '../../domain/user/User.js';
import type { Session } from '../../domain/session/Session.js';
import type { SessionRepository } from '../session/SessionRepository.js';
import type { UserRepository } from '../user/UserRepository.js';

export type ImpersonationErrorCode =
  | 'not_admin'
  | 'already_impersonating'
  | 'not_impersonating'
  | 'cannot_impersonate_self'
  | 'user_not_found'
  | 'admin_session_gone';

export class ImpersonationError extends Error {
  constructor(readonly code: ImpersonationErrorCode, message: string) {
    super(message);
    this.name = 'ImpersonationError';
  }
}

// Сессия «от имени» короткая: администратор смотрит интерфейс, а не работает за пользователя.
const IMPERSONATION_TTL_MS = 2 * 60 * 60 * 1000;

type Deps = {
  readonly users: UserRepository;
  readonly sessions: SessionRepository;
  readonly idGen: () => string;
  readonly now: () => Date;
};

// Вход администратора от имени пользователя: отдельная сессия пользователя со ссылкой на
// сессию администратора. Права в ней — ровно пользовательские (admin-bypass не действует),
// поэтому интерфейс виден его глазами. Сессия администратора не трогается — в неё возвращаемся.
export class Impersonation {
  constructor(private readonly deps: Deps) {}

  async start(admin: User, adminSessionId: string, targetUserId: string): Promise<Session> {
    if (!admin.isAdmin) throw new ImpersonationError('not_admin', 'Входить от имени может только администратор');
    if (admin.id === targetUserId) {
      throw new ImpersonationError('cannot_impersonate_self', 'Это ваша учётная запись');
    }
    const adminSession = await this.deps.sessions.getById(adminSessionId);
    if (!adminSession) throw new ImpersonationError('admin_session_gone', 'Сессия администратора истекла — войдите заново');
    if (adminSession.impersonatorSessionId) {
      throw new ImpersonationError('already_impersonating', 'Сначала вернитесь в свою учётную запись');
    }
    const target = await this.deps.users.getById(targetUserId);
    if (!target) throw new ImpersonationError('user_not_found', 'Пользователь не найден');
    const now = this.deps.now().getTime();
    // Не дольше сессии администратора: она нужна, чтобы вернуться.
    const expiresAt = new Date(Math.min(now + IMPERSONATION_TTL_MS, adminSession.expiresAt.getTime()));
    return this.deps.sessions.create({
      id: this.deps.idGen(),
      userId: target.id,
      expiresAt,
      impersonatorSessionId: adminSession.id,
    });
  }

  // Завершить сессию «от имени» и вернуть сессию администратора, из которой в неё вошли.
  async stop(sessionId: string): Promise<Session> {
    const session = await this.deps.sessions.getById(sessionId);
    if (!session?.impersonatorSessionId) {
      throw new ImpersonationError('not_impersonating', 'Вход от имени пользователя не активен');
    }
    await this.deps.sessions.delete(session.id);
    const adminSession = await this.deps.sessions.getById(session.impersonatorSessionId);
    if (!adminSession || adminSession.expiresAt.getTime() <= this.deps.now().getTime()) {
      throw new ImpersonationError('admin_session_gone', 'Сессия администратора истекла — войдите заново');
    }
    return adminSession;
  }
}
