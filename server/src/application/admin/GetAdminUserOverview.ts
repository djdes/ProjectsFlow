import type { AdminRepository, AdminUserOverviewData, AdminUserView } from './AdminRepository.js';
import type { AdminAuditEntry, AdminAuditLog } from './AdminAuditLog.js';
import { AdminUserError } from '../../domain/user/adminErrors.js';

type Deps = {
  readonly repo: AdminRepository;
  readonly audit: AdminAuditLog;
  readonly now: () => Date;
};

export type AdminUserOverview = AdminUserOverviewData & {
  readonly user: AdminUserView;
  readonly history: readonly AdminAuditEntry[];
};

const PERIOD_DAYS = 30;
const HISTORY_LIMIT = 50;

// The user panel in one request: the row itself (the panel also opens by link), memberships,
// AI spend and activity for the last 30 days, and the admin journal about the user.
export class GetAdminUserOverview {
  constructor(private readonly deps: Deps) {}

  async execute(userId: string): Promise<AdminUserOverview> {
    const user = (await this.deps.repo.listAllUsers()).find((u) => u.id === userId);
    if (!user) throw new AdminUserError('user_not_found', 'Пользователь не найден');
    const since = new Date(this.deps.now().getTime() - PERIOD_DAYS * 24 * 60 * 60 * 1000);
    const [data, history] = await Promise.all([
      this.deps.repo.loadUserOverview(userId, since),
      this.deps.audit.listForTarget(userId, HISTORY_LIMIT),
    ]);
    if (!data) throw new AdminUserError('user_not_found', 'Пользователь не найден');
    return { ...data, user, history };
  }
}
