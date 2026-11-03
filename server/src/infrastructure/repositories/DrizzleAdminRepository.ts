import { and, asc, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Database } from '../db/index.js';
import {
  agentTokens, commentNotifications, emailActionTokens, llmConnections, llmDeviceLogins, notifications,
  passwordResetTokens, projectGitTokenDelegations, projectMembers, projects, recentTaskViews, sessions,
  taskAttachments, taskDelegations, tasks, telegramChatWorkspaces, telegramGroupOwners, userGithubTokens,
  users, workspaceMembers, workspaces,
} from '../db/schema.js';
import { AdminUserError } from '../../domain/user/adminErrors.js';
import type { UserDeletionPlan, UserDeletionSnapshot } from '../../domain/user/userDeletion.js';
import { deleteProjectRows } from './DrizzleProjectRepository.js';
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
        telegramUserId: users.telegramUserId,
        telegramUsername: users.telegramUsername,
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
      telegramLinked: r.telegramUserId !== null,
      telegramUsername: r.telegramUsername ?? null,
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
    if (patch.telegram === null) Object.assign(set, TELEGRAM_CLEARED);
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

  loadUserDeletionSnapshot(id: string): Promise<UserDeletionSnapshot | null> {
    return loadDeletionSnapshot(this.db, id);
  }

  async deleteUser(
    id: string,
    actorId: string,
    decide: (snapshot: UserDeletionSnapshot) => UserDeletionPlan,
  ): Promise<{ plan: UserDeletionPlan; storageKeys: string[] }> {
    if (id === actorId) throw new AdminUserError('cannot_modify_self', 'Нельзя удалить свою учётную запись');
    return this.db.transaction(async (tx) => {
      await lockAdminActor(tx, actorId);
      await lockActiveUser(tx, id);
      // Rules run on data read under the locks, so the confirmed preview cannot go stale silently.
      const snapshot = await loadDeletionSnapshot(tx, id);
      if (!snapshot) throw new AdminUserError('user_not_found', 'Пользователь не найден');
      const plan = decide(snapshot);
      const now = new Date();

      // 1. Personal data: projects (with tasks, comments, files' rows) and the emptied workspaces.
      const storageKeys = plan.removeProjectIds.length === 0 ? [] : (await tx
        .select({ storageKey: taskAttachments.storageKey })
        .from(taskAttachments)
        .innerJoin(tasks, eq(tasks.id, taskAttachments.taskId))
        .where(inArray(tasks.projectId, [...plan.removeProjectIds]))).map((r) => r.storageKey);
      for (const projectId of plan.removeProjectIds) await deleteProjectRows(tx, projectId);
      for (const ws of plan.removeWorkspaces) {
        // Members, chat, invites and workspace activity go by ON DELETE CASCADE.
        await tx.delete(workspaces).where(eq(workspaces.id, ws.id));
      }

      // 2. Team data stays: tasks and project ownership move to the workspace owner.
      for (const r of plan.reassignments) {
        await tx.update(tasks).set({ assigneeUserId: r.toUserId })
          .where(and(eq(tasks.projectId, r.projectId), eq(tasks.assigneeUserId, id)));
        if (r.ownership) await tx.update(projects).set({ ownerId: r.toUserId }).where(eq(projects.id, r.projectId));
      }
      for (const t of plan.ownerTransfers) {
        await tx.update(workspaces).set({ ownerUserId: t.toUserId }).where(eq(workspaces.id, t.workspaceId));
      }
      await tx.update(taskDelegations).set({ status: 'withdrawn', respondedAt: now })
        .where(and(eq(taskDelegations.delegateUserId, id), inArray(taskDelegations.status, ['pending', 'accepted', 'pending_invite'])));

      // 3. Memberships and per-user state. Exclusions go with workspace_members by cascade.
      await tx.delete(workspaceMembers).where(eq(workspaceMembers.userId, id));
      await tx.delete(projectMembers).where(eq(projectMembers.userId, id));
      await tx.delete(notifications).where(eq(notifications.userId, id));
      await tx.delete(commentNotifications).where(eq(commentNotifications.recipientUserId, id));
      await tx.delete(recentTaskViews).where(eq(recentTaskViews.userId, id));
      await tx.delete(emailActionTokens).where(eq(emailActionTokens.userId, id));
      await tx.delete(telegramChatWorkspaces).where(eq(telegramChatWorkspaces.userId, id));
      await tx.delete(telegramGroupOwners).where(eq(telegramGroupOwners.ownerUserId, id));
      await tx.delete(llmDeviceLogins).where(eq(llmDeviceLogins.ownerUserId, id));
      await tx.delete(llmConnections).where(eq(llmConnections.ownerUserId, id));
      // Queued letters carry an email snapshot: they must not reach the former address.
      await tx.execute(sql`UPDATE mailing_recipients SET status = 'cancelled' WHERE user_id = ${id} AND status = 'queued'`);

      // 4. The profile row stays for FK references and history, without profile or credentials.
      await tx.update(users).set({
        deletedAt: now, displayName: 'Удалённый пользователь',
        email: `deleted-${randomUUID()}@deleted.invalid`, passwordHash: '', avatarUrl: null, isAdmin: false,
        ...TELEGRAM_CLEARED,
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
      return { plan, storageKeys };
    });
  }
}

// Same fields as the user's own Telegram unlink (DrizzleUserRepository.clearTelegramLink).
const TELEGRAM_CLEARED = {
  telegramUserId: null, telegramUsername: null, telegramFirstName: null,
  telegramPhotoUrl: null, telegramAuthDate: null, tgChatId: null,
  tgStartedAt: null, tgPairedAt: null, tgNotificationPrefs: null,
} as const;

async function loadDeletionSnapshot(db: Database | Transaction, id: string): Promise<UserDeletionSnapshot | null> {
  const [target] = await db.select({ isAdmin: users.isAdmin }).from(users)
    .where(and(eq(users.id, id), isNull(users.deletedAt))).limit(1);
  if (!target) return null;

  // Workspaces the user belongs to, owns, or still holds tasks in after leaving.
  const wsRows = await db
    .select({
      id: workspaces.id, name: workspaces.name, kind: workspaces.kind,
      ownerUserId: workspaces.ownerUserId, role: workspaceMembers.role,
    })
    .from(workspaces)
    .leftJoin(workspaceMembers, and(eq(workspaceMembers.workspaceId, workspaces.id), eq(workspaceMembers.userId, id)))
    .where(or(
      isNotNull(workspaceMembers.userId),
      eq(workspaces.ownerUserId, id),
      inArray(workspaces.id, db.select({ id: projects.workspaceId }).from(projects).where(eq(projects.ownerId, id))),
      inArray(workspaces.id, db.select({ id: projects.workspaceId }).from(projects)
        .innerJoin(tasks, eq(tasks.projectId, projects.id)).where(eq(tasks.assigneeUserId, id))),
    ))
    .orderBy(asc(workspaces.createdAt));
  const wsIds = wsRows.map((w) => w.id);
  if (wsIds.length === 0) return { userId: id, isAdmin: target.isAdmin, workspaces: [], projects: [] };

  const others = await db
    .select({
      workspaceId: workspaceMembers.workspaceId, userId: workspaceMembers.userId,
      role: workspaceMembers.role, displayName: users.displayName,
    })
    .from(workspaceMembers)
    .innerJoin(users, and(eq(users.id, workspaceMembers.userId), isNull(users.deletedAt)))
    .where(and(inArray(workspaceMembers.workspaceId, wsIds), ne(workspaceMembers.userId, id)))
    .orderBy(asc(workspaceMembers.createdAt), asc(workspaceMembers.userId));

  const projectRows = await db
    .select({
      id: projects.id, name: projects.name, workspaceId: projects.workspaceId,
      isInbox: projects.isInbox, ownerId: projects.ownerId,
      taskCount: sql<number>`(SELECT COUNT(*) FROM tasks t WHERE t.project_id = ${projects.id} AND t.deleted_at IS NULL)`,
      assignedToUser: sql<number>`(SELECT COUNT(*) FROM tasks t WHERE t.project_id = ${projects.id} AND t.assignee_user_id = ${id})`,
    })
    .from(projects)
    .where(inArray(projects.workspaceId, wsIds))
    .orderBy(asc(projects.createdAt));

  return {
    userId: id,
    isAdmin: target.isAdmin,
    workspaces: wsRows.map((w) => {
      const members = others.filter((m) => m.workspaceId === w.id);
      const recorded = w.ownerUserId !== id ? members.find((m) => m.userId === w.ownerUserId) : undefined;
      const successor = recorded ?? members.find((m) => m.role === 'owner') ?? null;
      return {
        id: w.id, name: w.name, kind: w.kind, role: w.role ?? null,
        recordedOwner: w.ownerUserId === id,
        otherActiveMembers: members.length,
        successor: successor ? { id: successor.userId, displayName: successor.displayName } : null,
        successorIsOwner: successor?.role === 'owner',
      };
    }),
    projects: projectRows.map((p) => ({
      id: p.id, name: p.name, workspaceId: p.workspaceId, isInbox: p.isInbox, ownerId: p.ownerId,
      taskCount: Number(p.taskCount), assignedToUser: Number(p.assignedToUser),
    })),
  };
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
