import type { AdminRepository } from './AdminRepository.js';
import type { AttachmentStorage } from '../task/AttachmentStorage.js';
import type { AdminAuditLog } from './AdminAuditLog.js';
import { AdminUserError } from '../../domain/user/adminErrors.js';
import {
  describeDeletionBlockers,
  planUserDeletion,
  type UserDeletionPlan,
} from '../../domain/user/userDeletion.js';

type Deps = {
  readonly repo: AdminRepository;
  readonly storage: AttachmentStorage;
  readonly audit: AdminAuditLog;
};

// What the admin sees before confirming. Built by the same rules as the deletion itself.
export class GetUserDeletionPreview {
  constructor(private readonly repo: AdminRepository) {}

  async execute(userId: string, actorId: string): Promise<UserDeletionPlan> {
    const snapshot = await this.repo.loadUserDeletionSnapshot(userId);
    if (!snapshot) throw new AdminUserError('user_not_found', 'Пользователь не найден');
    return planUserDeletion(snapshot, actorId);
  }
}

// Closes the account (see docs/admin-users.md): personal data goes, team data stays with
// the workspace owner, the profile row remains anonymized for history and authorship.
export class DeleteUserAsAdmin {
  constructor(private readonly deps: Deps) {}

  async execute(userId: string, actorId: string): Promise<UserDeletionPlan> {
    if (userId === actorId) {
      throw new AdminUserError('cannot_modify_self', 'Нельзя удалить свою учётную запись');
    }
    // The profile is anonymized by the deletion: the journal keeps who it was.
    const before = await this.deps.repo.getUserProfile(userId);
    const { plan, storageKeys } = await this.deps.repo.deleteUser(userId, actorId, (snapshot) => {
      const decided = planUserDeletion(snapshot, actorId);
      if (decided.blockers.length > 0) {
        throw new AdminUserError('deletion_blocked', describeDeletionBlockers(decided.blockers));
      }
      return decided;
    });
    await this.deps.audit.record([{
      actorUserId: actorId, targetUserId: userId, action: 'delete',
      before: before ? { email: before.email, displayName: before.displayName } : null,
      after: { ...plan.summary, removedWorkspaces: plan.removeWorkspaces.length },
    }]);
    // Files after the commit, best effort: rows are gone either way, orphans are harmless.
    for (const key of storageKeys) {
      this.deps.storage.delete(key).catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.error(`[DeleteUserAsAdmin] failed to delete attachment ${key}:`, err);
      });
    }
    return plan;
  }
}
