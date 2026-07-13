import { aliasedTable, and, asc, eq, isNotNull, ne, or, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import {
  projectMembers,
  projects,
  users,
  workspaceMembers,
  type ProjectRow,
  type UserRow,
} from '../db/schema.js';
import type {
  ProjectMembership,
  ProjectRole,
} from '../../domain/project/ProjectMembership.js';
import type { Project, ProjectStatus } from '../../domain/project/Project.js';
import type { User } from '../../domain/user/User.js';
import type { NotificationPrefs } from '../../domain/notifications/NotificationPrefs.js';
import type {
  AddMemberInput,
  ProjectMemberRepository,
  ProjectMemberWithUser,
  ProjectWithRole,
  SharedUser,
} from '../../application/project/ProjectMemberRepository.js';
import { parseJsonCol } from './jsonCol.js';
import {
  deriveMembership,
  projectRowVisibility,
  type ProjectAccessRow,
} from './workspaceMembershipView.js';

// Единое пространство (спека unified-workspace §3.2): доступ к проекту читается
// «насквозь» через projects.workspace_id → workspace_members (роль 1:1).
// project_members больше НЕ источник доступа — только ленивое хранилище
// per-member настроек (notification_prefs, sort_order, is_favorite,
// favorite_sort_order); строки создаются upsert-ом при первой записи настроек.
// Инвариант: is_inbox=true → единственный «участник» — владелец (role 'owner').

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl ?? null,
    isAdmin: row.isAdmin,
    createdAt: row.createdAt,
  };
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    icon: row.icon ?? null,
    status: row.status as ProjectStatus,
    gitRepoUrl: row.gitRepoUrl ?? null,
    kbRepoFullName: row.kbRepoFullName ?? null,
    isInbox: row.isInbox,
    kbKind: row.kbKind,
    financeVisibility: row.financeVisibility,
    dispatcherUserId: row.dispatcherUserId ?? null,
    multiTaskWorker: row.multiTaskWorker,
    description: row.description ?? null,
    coverUrl: row.coverUrl ?? null,
    coverPosition: row.coverPosition,
    publicSlug: row.publicSlug ?? null,
    isPublic: row.isPublic,
    publicIndexing: row.publicIndexing,
    appRepoFullName: row.appRepoFullName ?? null,
    siteSlug: row.siteSlug ?? null,
    createdAt: row.createdAt,
  };
}

export class DrizzleProjectMemberRepository implements ProjectMemberRepository {
  constructor(private readonly db: Database) {}

  // Срез projects для резолва доступа (workspace_id/owner_id/is_inbox).
  private async getProjectAccessRow(projectId: string): Promise<ProjectAccessRow | null> {
    const rows = await this.db
      .select({
        id: projects.id,
        workspaceId: projects.workspaceId,
        ownerId: projects.ownerId,
        isInbox: projects.isInbox,
        createdAt: projects.createdAt,
      })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    return rows[0] ?? null;
  }

  async findForProject(projectId: string, userId: string): Promise<ProjectMembership | null> {
    const rows = await this.db
      .select({
        id: projects.id,
        workspaceId: projects.workspaceId,
        ownerId: projects.ownerId,
        isInbox: projects.isInbox,
        createdAt: projects.createdAt,
        wmRole: workspaceMembers.role,
        wmCreatedAt: workspaceMembers.createdAt,
      })
      .from(projects)
      .leftJoin(
        workspaceMembers,
        and(
          eq(workspaceMembers.workspaceId, projects.workspaceId),
          eq(workspaceMembers.userId, userId),
        ),
      )
      .where(eq(projects.id, projectId))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    const wsMember =
      r.wmRole !== null && r.wmCreatedAt !== null
        ? { userId, role: r.wmRole as ProjectRole, createdAt: r.wmCreatedAt }
        : null;
    return deriveMembership(
      { id: r.id, workspaceId: r.workspaceId, ownerId: r.ownerId, isInbox: r.isInbox, createdAt: r.createdAt },
      userId,
      wsMember,
    );
  }

  async listByProject(projectId: string): Promise<ProjectMemberWithUser[]> {
    const project = await this.getProjectAccessRow(projectId);
    if (!project) return [];

    if (project.isInbox) {
      // Инвариант приватности: у Входящих единственный участник — владелец.
      const rows = await this.db
        .select({ user: users, prefs: projectMembers.notificationPrefs })
        .from(users)
        .leftJoin(
          projectMembers,
          and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, users.id)),
        )
        .where(eq(users.id, project.ownerId))
        .limit(1);
      const r = rows[0];
      if (!r) return [];
      // Тот же предикат, что findForProject: для своего inbox — role 'owner',
      // joinedAt = createdAt проекта (ws-строка не нужна и не запрашивается).
      const membership = deriveMembership(project, project.ownerId, null);
      if (!membership) return [];
      return [
        {
          ...membership,
          user: toUser(r.user),
          notificationPrefs: parseJsonCol<NotificationPrefs | null>(r.prefs, null),
        },
      ];
    }

    // Участники пространства проекта + их per-project prefs (ленивые строки — left join).
    const rows = await this.db
      .select({
        member: workspaceMembers,
        user: users,
        prefs: projectMembers.notificationPrefs,
      })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .leftJoin(
        projectMembers,
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, workspaceMembers.userId),
        ),
      )
      .where(eq(workspaceMembers.workspaceId, project.workspaceId))
      .orderBy(asc(workspaceMembers.createdAt));
    return rows.map((r) => ({
      projectId,
      userId: r.member.userId,
      role: r.member.role as ProjectRole,
      joinedAt: r.member.createdAt,
      user: toUser(r.user),
      notificationPrefs: parseJsonCol<NotificationPrefs | null>(r.prefs, null),
    }));
  }

  async listProjectsForUser(userId: string): Promise<ProjectWithRole[]> {
    return this.listProjectsWhere(userId, undefined);
  }

  async listProjectsForUserInWorkspace(
    userId: string,
    workspaceId: string,
  ): Promise<ProjectWithRole[]> {
    return this.listProjectsWhere(userId, workspaceId);
  }

  // Проекты всех пространств, где юзер участник, + его собственные Входящие.
  // LEFT JOIN workspace_members (не INNER!) — иначе свой inbox выпадал бы, если владельца
  // убрали из пространства, где inbox был создан (доступ к inbox через findForProject от
  // ws-членства НЕ зависит, листинг должен вести себя так же). Строка проекта включается
  // тем же предикатом, что projectRowVisibility: не-inbox — только если юзер участник
  // пространства (wm.user_id IS NOT NULL); свой inbox — по owner_id, независимо от ws.
  // Per-member настройки — left join к ленивым строкам project_members.
  private async listProjectsWhere(
    userId: string,
    workspaceId: string | undefined,
  ): Promise<ProjectWithRole[]> {
    const visible = or(
      and(eq(projects.isInbox, false), isNotNull(workspaceMembers.userId)),
      and(eq(projects.isInbox, true), eq(projects.ownerId, userId)),
    );
    const rows = await this.db
      .select({
        project: projects,
        wsRole: workspaceMembers.role,
        memberCount: sql<number>`(SELECT COUNT(*) FROM workspace_members wm2 WHERE wm2.workspace_id = ${projects.workspaceId})`,
        taskCount: sql<number>`(SELECT COUNT(*) FROM tasks t WHERE t.project_id = ${projects.id})`,
        isFavorite: projectMembers.isFavorite,
        favoriteSortOrder: projectMembers.favoriteSortOrder,
      })
      .from(projects)
      .leftJoin(
        workspaceMembers,
        and(
          eq(workspaceMembers.workspaceId, projects.workspaceId),
          eq(workspaceMembers.userId, userId),
        ),
      )
      .leftJoin(
        projectMembers,
        and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, userId)),
      )
      .where(
        workspaceId === undefined ? visible : and(visible, eq(projects.workspaceId, workspaceId)),
      )
      .orderBy(sql`COALESCE(${projectMembers.sortOrder}, 0)`, asc(projects.createdAt));
    // Роль/включение — через ту же чистую функцию (единый источник истины с findForProject).
    return rows.flatMap((r) => {
      const wsMember = r.wsRole !== null ? { role: r.wsRole as ProjectRole } : null;
      const vis = projectRowVisibility(r.project, userId, wsMember);
      if (!vis) return [];
      return [
        {
          ...toProject(r.project),
          role: vis.role,
          memberCount: r.project.isInbox ? 1 : Number(r.memberCount),
          taskCount: Number(r.taskCount),
          isFavorite: r.isFavorite ?? false,
          favoriteSortOrder: Number(r.favoriteSortOrder ?? 0),
        },
      ];
    });
  }

  async isMemberOfAnyProjectOwnedBy(userId: string, ownerUserId: string): Promise<boolean> {
    // «Общий проект» = юзер состоит в пространстве, где есть не-inbox проект ownerUserId.
    const rows = await this.db
      .select({ one: sql<number>`1` })
      .from(workspaceMembers)
      .innerJoin(projects, eq(projects.workspaceId, workspaceMembers.workspaceId))
      .where(
        and(
          eq(workspaceMembers.userId, userId),
          eq(projects.ownerId, ownerUserId),
          eq(projects.isInbox, false),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  // Легаси-запись в project_members: строка теперь лишь носитель per-member настроек,
  // доступ она НЕ даёт. Возвращаем синтетическое членство (findForProject мог бы вернуть
  // null, если юзер не в пространстве, — а add зовут и для «настроечных» строк).
  async add(input: AddMemberInput): Promise<ProjectMembership> {
    await this.db
      .insert(projectMembers)
      .values({ projectId: input.projectId, userId: input.userId, role: input.role })
      .onDuplicateKeyUpdate({ set: { role: input.role } });
    return {
      projectId: input.projectId,
      userId: input.userId,
      role: input.role,
      joinedAt: new Date(),
    };
  }

  async getNotificationPrefs(
    projectId: string,
    userId: string,
  ): Promise<NotificationPrefs | null> {
    const rows = await this.db
      .select({ prefs: projectMembers.notificationPrefs })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
      .limit(1);
    return parseJsonCol<NotificationPrefs | null>(rows[0]?.prefs, null);
  }

  // Ленивое создание строки настроек: у ws-участника может ещё не быть строки
  // в project_members — upsert. role в такой строке — placeholder, доступ не даёт.
  async setNotificationPrefs(
    projectId: string,
    userId: string,
    prefs: NotificationPrefs,
  ): Promise<void> {
    await this.db
      .insert(projectMembers)
      .values({ projectId, userId, role: 'editor', notificationPrefs: prefs })
      .onDuplicateKeyUpdate({ set: { notificationPrefs: prefs } });
  }

  async listSharedUsers(userId: string): Promise<SharedUser[]> {
    // Пул «знакомых» = участники общих ПРОСТРАНСТВ (спека §3.2). Self-join
    // workspace_members: wm1 — членства caller-а, wm2 — остальные участники тех же пространств.
    const wm1 = aliasedTable(workspaceMembers, 'wm1');
    const wm2 = aliasedTable(workspaceMembers, 'wm2');
    const rows = await this.db
      .selectDistinct({
        id: users.id,
        displayName: users.displayName,
        email: users.email,
        avatarUrl: users.avatarUrl,
      })
      .from(wm1)
      .innerJoin(wm2, eq(wm2.workspaceId, wm1.workspaceId))
      .innerJoin(users, eq(users.id, wm2.userId))
      .where(and(eq(wm1.userId, userId), ne(wm2.userId, userId)))
      .orderBy(asc(users.displayName));
    return rows;
  }

  async reorderForUser(userId: string, orderedIds: readonly string[]): Promise<void> {
    if (orderedIds.length === 0) return;
    // Скоупим по реально доступным проектам (мусорный id от клиента не должен
    // создать строку с несуществующим project_id — FK упадёт).
    const accessible = new Set((await this.listProjectsForUser(userId)).map((p) => p.id));
    const ids = orderedIds.filter((id) => accessible.has(id));
    if (ids.length === 0) return;
    await this.db.transaction(async (tx) => {
      for (let i = 0; i < ids.length; i += 1) {
        await tx
          .insert(projectMembers)
          .values({ projectId: ids[i]!, userId, role: 'editor', sortOrder: i })
          .onDuplicateKeyUpdate({ set: { sortOrder: i } });
      }
    });
  }

  async setFavorite(projectId: string, userId: string, favorite: boolean): Promise<void> {
    if (!favorite) {
      // Нет строки — и так не favorite: обычного UPDATE достаточно.
      await this.db
        .update(projectMembers)
        .set({ isFavorite: false })
        .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
      return;
    }
    // favorite=true: ленивый upsert строки + favorite_sort_order = MAX+1 одной транзакцией.
    await this.db.transaction(async (tx) => {
      const rows = await tx
        .select({ max: sql<number | null>`MAX(${projectMembers.favoriteSortOrder})` })
        .from(projectMembers)
        .where(
          and(eq(projectMembers.userId, userId), eq(projectMembers.isFavorite, true)),
        );
      const nextOrder = Number(rows[0]?.max ?? -1) + 1;
      await tx
        .insert(projectMembers)
        .values({
          projectId,
          userId,
          role: 'editor',
          isFavorite: true,
          favoriteSortOrder: nextOrder,
        })
        .onDuplicateKeyUpdate({ set: { isFavorite: true, favoriteSortOrder: nextOrder } });
    });
  }

  async reorderFavoritesForUser(userId: string, orderedIds: readonly string[]): Promise<void> {
    if (orderedIds.length === 0) return;
    const accessible = new Set((await this.listProjectsForUser(userId)).map((p) => p.id));
    const ids = orderedIds.filter((id) => accessible.has(id));
    if (ids.length === 0) return;
    await this.db.transaction(async (tx) => {
      for (let i = 0; i < ids.length; i += 1) {
        await tx
          .insert(projectMembers)
          .values({
            projectId: ids[i]!,
            userId,
            role: 'editor',
            isFavorite: true,
            favoriteSortOrder: i,
          })
          .onDuplicateKeyUpdate({ set: { favoriteSortOrder: i } });
      }
    });
  }
}
