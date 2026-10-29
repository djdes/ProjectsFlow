import type { AdminRepository, AdminUpdateUserPatch } from './AdminRepository.js';
import { AdminUserError } from '../../domain/user/adminErrors.js';

export class UpdateUserAsAdmin {
  constructor(private readonly repo: AdminRepository) {}

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
    await this.repo.updateUser(userId, normalized, actorId);
  }
}
