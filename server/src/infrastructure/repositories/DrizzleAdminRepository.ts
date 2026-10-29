import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Database } from '../db/index.js';
import { agentTokens, passwordResetTokens, projectGitTokenDelegations, projects, sessions, userGithubTokens, users } from '../db/schema.js';
import { AdminUserError } from '../../domain/user/adminErrors.js';
import type { ProjectStatus } from '../../domain/project/Project.js';
import type {
  AdminProjectView,
  AdminRepository,
  AdminUpdateUserPatch,
  AdminUserView,
} from '../../application/admin/AdminRepository.js';

export class DrizzleAdminRepository implements AdminRepository {
  constructor(private readonly db: Database) {}

  async listAllProjects(): Promise<AdminProjectView[]> {
    // Один проект — одна строка (без дублей по members). Счётчики — коррелированными
    // подзапросами; владелец — JOIN по owner_id. Inbox-проекты скрываем.
    const rows = await this.db
      .select({
        id: projects.id,
        name: projects.name,
        status: projects.status,
        gitRepoUrl: projects.gitRepoUrl,
        ownerId: projects.ownerId,
        ownerDisplayName: users.displayName,
        ownerEmail: users.email,
        createdAt: projects.createdAt,
        memberCount: sql<number>`(SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = ${projects.id})`,
        // deleted_at IS NULL (db/134): задачи из корзины не должны раздувать счётчик.
        taskCount: sql<number>`(SELECT COUNT(*) FROM tasks t WHERE t.project_id = ${projects.id} AND t.deleted_at IS NULL)`,
      })
      .from(projects)
      .innerJoin(users, eq(users.id, projects.ownerId))
      .where(eq(projects.isInbox, false))
      .orderBy(asc(users.displayName), asc(projects.name));

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status as ProjectStatus,
      gitRepoUrl: r.gitRepoUrl ?? null,
      ownerId: r.ownerId,
      ownerDisplayName: r.ownerDisplayName,
      ownerEmail: r.ownerEmail,
      memberCount: Number(r.memberCount),
      taskCount: Number(r.taskCount),
      createdAt: r.createdAt,
    }));
  }

  async listAllUsers(): Promise<AdminUserView[]> {
    const rows = await this.db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        isAdmin: users.isAdmin,
        createdAt: users.createdAt,
        plan: users.plan,
        subscriptionExpiresAt: users.subscriptionExpiresAt,
        projectCount: sql<number>`(SELECT COUNT(*) FROM project_members pm WHERE pm.user_id = ${users.id})`,
        // Сколько проектов где юзер OWNER (для знаменателя «X/Y» делегации).
        // Исключаем inbox — он персональный, делегация для него не имеет смысла.
        ownedProjectCount: sql<number>`(
          SELECT COUNT(*) FROM projects p
          WHERE p.owner_id = ${users.id} AND p.is_inbox = FALSE
        )`,
        // v0.15: per-member делегации. В admin UI «X разрешил свой GH» = у X есть
        // ВКЛЮЧЁННАЯ запись делегации в проекте где X — owner. Если другие
        // members этого проекта тоже разрешили — это видно отдельно в диалоге.
        delegationEnabledCount: sql<number>`(
          SELECT COUNT(*) FROM project_git_token_delegations d
          INNER JOIN projects p ON p.id = d.project_id
          WHERE p.owner_id = ${users.id}
            AND d.granter_user_id = ${users.id}
            AND d.enabled = TRUE
        )`,
        // Подключён ли GitHub. UI рисует индикатор «нет GH — делегацию включать нельзя».
        githubConnected: sql<number>`(
          SELECT COUNT(*) FROM user_github_tokens g WHERE g.user_id = ${users.id}
        )`,
      })
      .from(users)
      .where(isNull(users.deletedAt))
      .orderBy(asc(users.createdAt));

    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      displayName: r.displayName,
      avatarUrl: r.avatarUrl ?? null,
      isAdmin: r.isAdmin,
      projectCount: Number(r.projectCount),
      ownedProjectCount: Number(r.ownedProjectCount),
      delegationEnabledCount: Number(r.delegationEnabledCount),
      githubConnected: Number(r.githubConnected) > 0,
      plan: r.plan,
      subscriptionExpiresAt: r.subscriptionExpiresAt ?? null,
      createdAt: r.createdAt,
    }));
  }

  async updateUser(id: string, patch: AdminUpdateUserPatch, actorId: string): Promise<void> {
    if (id === actorId && patch.isAdmin === false) {
      throw new AdminUserError('cannot_modify_self', 'Нельзя снять права администратора у себя');
    }
    const set: Record<string, unknown> = {};
    if (patch.displayName !== undefined) set['displayName'] = patch.displayName;
    if (patch.email !== undefined) set['email'] = patch.email.toLowerCase();
    if (patch.isAdmin !== undefined) set['isAdmin'] = patch.isAdmin;
    if (patch.avatarUrl === null) set['avatarUrl'] = null;
    if (Object.keys(set).length === 0) return;
    try {
      await this.db.transaction(async (tx) => {
        await lockAdminActor(tx, actorId);
        await lockActiveUser(tx, id);
        await tx.update(users).set(set).where(eq(users.id, id));
        // A reset link sent to the former email must not survive a change of address.
        if (patch.email !== undefined) await tx.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, id));
      });
    } catch (error) {
      if (isDuplicateEntry(error)) throw new AdminUserError('email_taken', 'Эта почта уже используется');
      throw error;
    }
  }

  async deleteUser(id: string, actorId: string): Promise<void> {
    if (id === actorId) throw new AdminUserError('cannot_modify_self', 'Нельзя удалить свою учётную запись');
    await this.db.transaction(async (tx) => {
      await lockAdminActor(tx, actorId);
      await lockActiveUser(tx, id);
      const now = new Date();
      // Retain the row for FK references, removing the account's profile and credentials.
      await tx.update(users).set({
        deletedAt: now, displayName: 'Удалённый пользователь',
        email: `deleted-${randomUUID()}@deleted.invalid`, passwordHash: '', avatarUrl: null, isAdmin: false,
        telegramUserId: null, telegramUsername: null, telegramFirstName: null,
        telegramPhotoUrl: null, telegramAuthDate: null, tgChatId: null,
        tgStartedAt: null, tgPairedAt: null, tgNotificationPrefs: null,
        defaultNotificationPrefs: null, defaultKanbanColors: null, uiPrefs: null,
        currentWorkspaceId: null, plan: 'free', subscriptionStartedAt: null, subscriptionExpiresAt: null,
      }).where(eq(users.id, id));
      await tx.delete(sessions).where(eq(sessions.userId, id));
      await tx.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, id));
      await tx.update(agentTokens).set({ revokedAt: now }).where(eq(agentTokens.userId, id));
      await tx.delete(userGithubTokens).where(eq(userGithubTokens.userId, id));
      await tx.update(projectGitTokenDelegations).set({ enabled: false, revokedAt: now })
        .where(eq(projectGitTokenDelegations.granterUserId, id));
      await tx.update(projects).set({ dispatcherUserId: null }).where(eq(projects.dispatcherUserId, id));
    });
  }
}

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

async function lockAdminActor(tx: Transaction, actorId: string): Promise<void> {
  // Serialize changes to admins and recheck the actor. Concurrent demotions cannot remove all admins.
  const admins = await tx.select({ id: users.id }).from(users)
    .where(and(eq(users.isAdmin, true), isNull(users.deletedAt))).orderBy(asc(users.id)).for('update');
  if (!admins.some((admin) => admin.id === actorId)) {
    throw new AdminUserError('admin_access_revoked', 'Нужны права администратора');
  }
}

async function lockActiveUser(tx: Transaction, id: string): Promise<void> {
  const [user] = await tx.select({ id: users.id }).from(users)
    .where(and(eq(users.id, id), isNull(users.deletedAt))).for('update');
  if (!user) throw new AdminUserError('user_not_found', 'Пользователь не найден');
}

function isDuplicateEntry(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: string; cause?: unknown };
  return candidate.code === 'ER_DUP_ENTRY' || (candidate.cause !== error && isDuplicateEntry(candidate.cause));
}
