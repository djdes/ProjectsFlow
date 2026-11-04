import type { AdminRepository } from './AdminRepository.js';
import type { AdminAuditLog } from './AdminAuditLog.js';
import type { SessionRepository } from '../session/SessionRepository.js';
import { AdminUserError } from '../../domain/user/adminErrors.js';

type Deps = {
  readonly repo: AdminRepository;
  readonly sessions: SessionRepository;
  readonly audit: AdminAuditLog;
};

// Ends every session of the user, impersonation ones included. Agent tokens (Ralph, MCP)
// are separate credentials and stay.
export class SignOutUserEverywhere {
  constructor(private readonly deps: Deps) {}

  async execute(userId: string, actorId: string): Promise<void> {
    if (userId === actorId) {
      throw new AdminUserError('cannot_modify_self', 'Свои сессии завершайте через выход из аккаунта');
    }
    const user = await this.deps.repo.getUserProfile(userId);
    if (!user) throw new AdminUserError('user_not_found', 'Пользователь не найден');
    await this.deps.sessions.deleteAllForUser(userId);
    await this.deps.audit.record([{ actorUserId: actorId, targetUserId: userId, action: 'sign_out_all' }]);
  }
}
