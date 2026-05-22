import type { AdminRepository, AdminUpdateUserPatch } from './AdminRepository.js';

export class UpdateUserAsAdmin {
  constructor(private readonly repo: AdminRepository) {}

  execute(userId: string, patch: AdminUpdateUserPatch): Promise<void> {
    return this.repo.updateUser(userId, patch);
  }
}
