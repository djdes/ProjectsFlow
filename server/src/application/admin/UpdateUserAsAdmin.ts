import type { AdminRepository, AdminUpdateUserPatch } from './AdminRepository.js';
import { diffFields, type AdminAuditInput, type AdminAuditLog } from './AdminAuditLog.js';
import { AdminUserError } from '../../domain/user/adminErrors.js';

export class UpdateUserAsAdmin {
  constructor(
    private readonly repo: AdminRepository,
    private readonly audit: AdminAuditLog,
  ) {}

  async execute(userId: string, patch: AdminUpdateUserPatch, actorId: string): Promise<void> {
    if (userId === actorId && patch.isAdmin === false) {
      throw new AdminUserError('cannot_modify_self', 'Нельзя снять права администратора у себя');
    }
    const normalized = {
      ...patch,
      ...(patch.displayName !== undefined ? { displayName: patch.displayName.trim() } : {}),
      ...(patch.email !== undefined ? { email: patch.email.trim().toLowerCase() } : {}),
    };
    if (Object.keys(normalized).length === 0
      || (normalized.displayName !== undefined && (!normalized.displayName || normalized.displayName.length > 80))
      || (normalized.email !== undefined && (normalized.email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.email)))) {
      throw new AdminUserError('invalid_user_data', 'Укажите имя до 80 символов и корректную почту');
    }
    const before = await this.repo.getUserProfile(userId);
    if (!before) throw new AdminUserError('user_not_found', 'Пользователь не найден');
    await this.repo.updateUser(userId, normalized, actorId);

    const entries: AdminAuditInput[] = [];
    const profile = diffFields<Record<string, unknown>>(
      {
        displayName: before.displayName,
        email: before.email,
        avatarUrl: before.avatarUrl,
        telegram: before.telegramLinked ? (before.telegramUsername ? `@${before.telegramUsername}` : 'привязан') : null,
      },
      {
        displayName: normalized.displayName,
        email: normalized.email,
        avatarUrl: normalized.avatarUrl,
        telegram: normalized.telegram,
      },
    );
    if (profile) entries.push({ actorUserId: actorId, targetUserId: userId, action: 'profile_update', ...profile });
    if (normalized.isAdmin !== undefined && normalized.isAdmin !== before.isAdmin) {
      entries.push({
        actorUserId: actorId, targetUserId: userId, action: 'role_change',
        before: { isAdmin: before.isAdmin }, after: { isAdmin: normalized.isAdmin },
      });
    }
    await this.audit.record(entries);
  }
}
