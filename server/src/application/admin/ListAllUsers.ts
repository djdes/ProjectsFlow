import type { AdminRepository, AdminUserView } from './AdminRepository.js';
import { queryAdminUsers, type AdminUserPage, type AdminUserQuery } from '../../domain/user/adminUserDirectory.js';

// The admin users console: one read of all accounts, then search/filter/sort/page by the
// domain rules (see adminUserDirectory.ts for why this is not done in SQL yet).
export class ListAllUsers {
  constructor(
    private readonly repo: AdminRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(query: AdminUserQuery): Promise<AdminUserPage<AdminUserView>> {
    return queryAdminUsers(await this.repo.listAllUsers(), query, this.now());
  }
}
