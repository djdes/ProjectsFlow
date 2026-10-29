import type { AdminRepository } from './AdminRepository.js';
import { AdminUserError } from '../../domain/user/adminErrors.js';

export class DeleteUserAsAdmin {
  constructor(private readonly repo: AdminRepository) {}

  async execute(userId: string, actorId: string): Promise<void> {
    if (userId === actorId) {
      throw new AdminUserError('cannot_modify_self', 'Нельзя удалить свою учётную запись');
    }
    await this.repo.deleteUser(userId, actorId);
  }
}
