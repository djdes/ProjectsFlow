import type { AdminRepository } from './AdminRepository.js';
import type { AdminAuditLog } from './AdminAuditLog.js';
import { AdminUserError } from '../../domain/user/adminErrors.js';

type Deps = {
  readonly repo: AdminRepository;
  // RequestPasswordReset: the same letter and one-hour link as «Забыли пароль?».
  readonly requestPasswordReset: { execute(email: string): Promise<void> };
  readonly audit: AdminAuditLog;
};

export class SendPasswordResetAsAdmin {
  constructor(private readonly deps: Deps) {}

  async execute(userId: string, actorId: string): Promise<{ email: string }> {
    const user = await this.deps.repo.getUserProfile(userId);
    if (!user) throw new AdminUserError('user_not_found', 'Пользователь не найден');
    await this.deps.requestPasswordReset.execute(user.email);
    await this.deps.audit.record([{
      actorUserId: actorId, targetUserId: userId, action: 'password_reset_sent', after: { email: user.email },
    }]);
    return { email: user.email };
  }
}
