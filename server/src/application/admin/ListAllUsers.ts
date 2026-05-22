import type { AdminRepository, AdminUserView } from './AdminRepository.js';

export class ListAllUsers {
  constructor(private readonly repo: AdminRepository) {}

  execute(): Promise<AdminUserView[]> {
    return this.repo.listAllUsers();
  }
}
