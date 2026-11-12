import { aliasedTable, and, asc, eq, inArray, isNotNull, ne, or, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import {
  projectMembers,
  projectWorkspaceAccess,
  projects,
  users,
  workspaceMembers,
  workspaceProjectExclusions,
  workspaces,
  type ProjectRow,
  type UserRow,
} from '../db/schema.js';
import type { TaskVisibility, VisibleTaskLike } from '../../application/project/TaskVisibility.js';
import type {
  ProjectMembership,
  ProjectRole,
} from '../../domain/project/ProjectMembership.js';
import {
  DEFAULT_PUBLIC_APPEARANCE,
  type Project,
  type ProjectStatus,
  type PublicAppearance,
} from '../../domain/project/Project.js';
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
    workspaceId: row.workspaceId,
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
    publicAppearance: {
      ...DEFAULT_PUBLIC_APPEARANCE,
      ...parseJsonCol<Partial<PublicAppearance>>(row.publicAppearance, {}),
    },
    appRepoFullName: row.appRepoFullName ?? null,
    siteSlug: row.siteSlug ?? null,
    createdAt: row.createdAt,
  };
}

// Сила роли: из нескольких членств (основное + подключённые пространства) берём лучшую.
const ROLE_RANK: Record<ProjectRole, number> = { viewer: 1, editor: 2, lead: 3, owner: 4 };

// Пространства проекта для join'ов: основное ИЛИ подключённое к проекту (db/182).
const projectWorkspaceSql = (workspaceIdCol: unknown) =>
  sql`(${workspaceIdCol} = ${projects.workspaceId} OR ${workspaceIdCol} IN (SELECT a.workspace_id FROM project_workspace_access a WHERE a.project_id = ${projects.id}))`;

export class DrizzleProjectMemberRepository implements ProjectMemberRepository {
  constructor(
    private readonly db: Database,
    // Видимость задач общих проектов (db/182). Без неё все задачи видны, как раньше.
    private readonly visibility?: Pick<TaskVisibility, 'filterTasks' | 'filterAudience' | 'canSee'>,
  ) {}

  async canSeeTask(userId: string, task: VisibleTaskLike): Promise<boolean> {
    return this.visibility ? this.visibility.canSee(userId, task) : true;
  }

  async filterVisibleTasks<T extends VisibleTaskLike>(userId: string, list: readonly T[]): Promise<T[]> {
    return this.visibility ? this.visibility.filterTasks(userId, list) : [...list];
  }

  async filterTaskAudience(task: VisibleTaskLike, userIds: readonly string[]): Promise<string[]> {
    return this.visibility ? this.visibility.filterAudience(task, userIds) : [...userIds];
  }

  // Явно скрыт галочкой: членство в пространствах проекта есть, но во всех он скрыт
  // (owner/lead не скрываются).
  async isProjectHidden(projectId: string, userId: string): Promise<boolean> {
    const rows = await this.db
      .select({
        role: workspaceMembers.role,
        excluded: sql<number>`EXISTS (SELECT 1 FROM workspace_project_exclusions x WHERE x.workspace_id = ${workspaceMembers.workspaceId} AND x.project_id = ${projects.id} AND x.user_id = ${userId})`,
      })
      .from(projects)
      .innerJoin(workspaceMembers, and(eq(workspaceMembers.userId, userId), projectWorkspaceSql(workspaceMembers.workspaceId)))
      .where(and(eq(projects.id, projectId), eq(projects.isInbox, false)));
    if (rows.length === 0) return false;
    return rows.every((row) => Boolean(row.excluded) && row.role !== 'owner' && row.role !== 'lead');
  }

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
    // Членство — через основное пространство проекта или любое подключённое (db/182): строк
    // может быть несколько, берём лучшую видимую роль. Скрытие галочкой — по пространству.
    const rows = await this.db
      .select({
        id: projects.id,
        workspaceId: projects.workspaceId,
        ownerId: projects.ownerId,
        isInbox: projects.isInbox,
        createdAt: projects.createdAt,
        wmRole: workspaceMembers.role,
        wmCreatedAt: workspaceMembers.createdAt,
        excluded: sql<number>`EXISTS (SELECT 1 FROM workspace_project_exclusions x WHERE x.workspace_id = ${workspaceMembers.workspaceId} AND x.project_id = ${projects.id} AND x.user_id = ${userId})`,
      })
      .from(projects)
      .leftJoin(
        workspaceMembers,
        and(eq(workspaceMembers.userId, userId), projectWorkspaceSql(workspaceMembers.workspaceId)),
      )
      .where(eq(projects.id, projectId));
    const first = rows[0];
    if (!first) return null;
    const project = {
      id: first.id,
      workspaceId: first.workspaceId,
      ownerId: first.ownerId,
      isInbox: first.isInbox,
      createdAt: first.createdAt,
    };
    let best: ProjectMembership | null = null;
    for (const r of rows) {
      const wsMember =
        r.wmRole !== null && r.wmCreatedAt !== null
          ? { userId, role: r.wmRole as ProjectRole, createdAt: r.wmCreatedAt }
          : null;
      const membership = deriveMembership(project, userId, wsMember, Boolean(r.excluded));
      if (membership && (!best || ROLE_RANK[membership.role] > ROLE_RANK[best.role])) best = membership;
    }
    return best;
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

    // Участники основного и подключённых пространств проекта (db/182) + их per-project prefs
    // (ленивые строки — left join). Человек из нескольких пространств — одной строкой с
    // лучшей ролью; скрытие галочкой — по пространству.
    const linked = await this.db
      .select({ workspaceId: projectWorkspaceAccess.workspaceId })
      .from(projectWorkspaceAccess)
      .where(eq(projectWorkspaceAccess.projectId, projectId));
    const workspaceIds = [...new Set([project.workspaceId, ...linked.map((row) => row.workspaceId)])];
    const all = await this.db
      .select({
        member: workspaceMembers,
        user: users,
        prefs: projectMembers.notificationPrefs,
        excluded: sql<number>`EXISTS (SELECT 1 FROM workspace_project_exclusions x WHERE x.workspace_id = ${workspaceMembers.workspaceId} AND x.project_id = ${projectId} AND x.user_id = ${workspaceMembers.userId})`,
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
      .where(inArray(workspaceMembers.workspaceId, workspaceIds))
      .orderBy(asc(workspaceMembers.createdAt));
    const bestByUser = new Map<string, (typeof all)[number]>();
    for (const r of all) {
      if (!projectRowVisibility(project, r.member.userId, r.member, Boolean(r.excluded))) continue;
      const current = bestByUser.get(r.member.userId);
      if (!current || ROLE_RANK[r.member.role as ProjectRole] > ROLE_RANK[current.member.role as ProjectRole]) {
        bestByUser.set(r.member.userId, r);
      }
    }
    const rows = all.filter((r) => bestByUser.get(r.member.userId) === r);
    return rows.map((r) => ({
      projectId,
      // Создатель проекта — owner своего проекта поверх ws-роли (тот же апгрейд, что в
      // projectRowVisibility/findForProject), чтобы «мой доступ» и «список участников»
      // не разъезжались (создатель везде owner).
      role:
        r.member.userId === project.ownerId
          ? ('owner' as ProjectRole)
          : (r.member.role as ProjectRole),
      userId: r.member.userId,
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

  // Проекты пространств юзера + его собственные Входящие. Проект виден через основное
  // пространство ИЛИ подключённое (db/182). В разрезе пространства W: проекты основного W и
  // подключённые к W, роль и скрытие галочкой — по членству именно в W. Без W — все проекты
  // всех пространств юзера, по одной строке на проект (лучшая роль).
  // LEFT JOIN workspace_members (не INNER!) — иначе свой inbox выпадал бы, если владельца
  // убрали из пространства, где inbox был создан. Per-member настройки — left join к ленивым
  // строкам project_members.
  private async listProjectsWhere(
    userId: string,
    workspaceId: string | undefined,
  ): Promise<ProjectWithRole[]> {
    const visible = or(
      and(eq(projects.isInbox, false), isNotNull(workspaceMembers.userId)),
      and(eq(projects.isInbox, true), eq(projects.ownerId, userId)),
    );
    const membershipJoin =
      workspaceId === undefined
        ? and(eq(workspaceMembers.userId, userId), projectWorkspaceSql(workspaceMembers.workspaceId))
        : and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.workspaceId, workspaceId));
    const inWorkspace =
      workspaceId === undefined
        ? undefined
        : or(
            eq(projects.workspaceId, workspaceId),
            sql`${projects.id} IN (SELECT a.project_id FROM project_workspace_access a WHERE a.workspace_id = ${workspaceId})`,
          );
    const rows = await this.db
      .select({
        project: projects,
        wsRole: workspaceMembers.role,
        excluded: sql<number>`EXISTS (SELECT 1 FROM workspace_project_exclusions x WHERE x.workspace_id = ${workspaceMembers.workspaceId} AND x.project_id = ${projects.id} AND x.user_id = ${userId})`,
        // Участники всех пространств проекта (основное + подключённые), без скрытых галочкой.
        memberCount: sql<number>`(SELECT COUNT(DISTINCT wm2.user_id) FROM workspace_members wm2 WHERE (wm2.workspace_id = ${projects.workspaceId} OR wm2.workspace_id IN (SELECT a2.workspace_id FROM project_workspace_access a2 WHERE a2.project_id = ${projects.id})) AND (wm2.role IN ('owner', 'lead') OR NOT EXISTS (SELECT 1 FROM workspace_project_exclusions x WHERE x.workspace_id = wm2.workspace_id AND x.project_id = ${projects.id} AND x.user_id = wm2.user_id)))`,
        // deleted_at IS NULL (db/134): задачи из корзины не должны раздувать счётчик.
        taskCount: sql<number>`(SELECT COUNT(*) FROM tasks t WHERE t.project_id = ${projects.id} AND t.deleted_at IS NULL)`,
        // Избранное ВЫЧИСЛЯЕМОЕ: проект в избранном, если у пользователя есть незавершённая
        // назначенная задача в нём. Колонки db/040 is_favorite/favorite_sort_order больше не
        // читаем; ручная поправка из меню проекта — favorite_override (db/172), см. ниже.
        favoriteOverride: projectMembers.favoriteOverride,
        isFavorite: sql<number>`EXISTS (SELECT 1 FROM tasks tf WHERE tf.project_id = ${projects.id} AND tf.assignee_user_id = ${userId} AND tf.status <> 'done' AND tf.deleted_at IS NULL)`,
      })
      .from(projects)
      .leftJoin(workspaceMembers, membershipJoin)
      .leftJoin(
        projectMembers,
        and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, userId)),
      )
      .where(inWorkspace === undefined ? visible : and(visible, inWorkspace))
      .orderBy(sql`COALESCE(${projectMembers.sortOrder}, 0)`, asc(projects.createdAt));
    // Роль/включение — через ту же чистую функцию (единый источник истины с findForProject).
    const byProject = new Map<string, { row: (typeof rows)[number]; role: ProjectRole }>();
    for (const r of rows) {
      const wsMember = r.wsRole !== null ? { role: r.wsRole as ProjectRole } : null;
      const vis = projectRowVisibility(r.project, userId, wsMember, Boolean(r.excluded));
      if (!vis) continue;
      const current = byProject.get(r.project.id);
      if (!current || ROLE_RANK[vis.role] > ROLE_RANK[current.role]) byProject.set(r.project.id, { row: r, role: vis.role });
    }
    const shared = await this.sharedWorkspacesOf([...byProject.keys()]);
    return [...byProject.values()].map(({ row: r, role }) => ({
      ...toProject(r.project),
      role,
      memberCount: r.project.isInbox ? 1 : Number(r.memberCount),
      taskCount: Number(r.taskCount),
      // Inbox никогда не попадает в избранное (как и раньше — его нельзя было отметить).
      // Ручная поправка пользователя (закрепить/скрыть) важнее вычисленного значения.
      isFavorite: !r.project.isInbox && (r.favoriteOverride ?? Boolean(r.isFavorite)),
      // Ручной порядок избранного убран — поле оставлено в типе как 0 (клиент больше не сортирует по нему).
      favoriteSortOrder: 0,
      sharedWorkspaces: shared.get(r.project.id) ?? [],
    }));
  }

  // Пространства общих проектов (основное первым) — для значка «общий» и подписей задач.
  // Проекты без подключённых пространств в ответ не попадают.
  private async sharedWorkspacesOf(
    projectIds: readonly string[],
  ): Promise<Map<string, Array<{ id: string; name: string; icon: string | null }>>> {
    const result = new Map<string, Array<{ id: string; name: string; icon: string | null }>>();
    if (projectIds.length === 0) return result;
    const linked = await this.db
      .select({
        projectId: projectWorkspaceAccess.projectId,
        homeWorkspaceId: projects.workspaceId,
        id: workspaces.id,
        name: workspaces.name,
        icon: workspaces.icon,
      })
      .from(projectWorkspaceAccess)
      .innerJoin(projects, eq(projects.id, projectWorkspaceAccess.projectId))
      .innerJoin(workspaces, eq(workspaces.id, projectWorkspaceAccess.workspaceId))
      .where(
        and(
          inArray(projectWorkspaceAccess.projectId, [...projectIds]),
          ne(projectWorkspaceAccess.workspaceId, projects.workspaceId),
        ),
      );
    if (linked.length === 0) return result;
    const homeIds = [...new Set(linked.map((row) => row.homeWorkspaceId))];
    const homes = await this.db
      .select({ id: workspaces.id, name: workspaces.name, icon: workspaces.icon })
      .from(workspaces)
      .where(inArray(workspaces.id, homeIds));
    for (const row of linked) {
      let list = result.get(row.projectId);
      if (!list) {
        const home = homes.find((h) => h.id === row.homeWorkspaceId);
        list = home ? [{ id: home.id, name: home.name, icon: home.icon ?? null }] : [];
        result.set(row.projectId, list);
      }
      list.push({ id: row.id, name: row.name, icon: row.icon ?? null });
    }
    return result;
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
          sql`(${workspaceMembers.role} IN ('owner', 'lead') OR NOT EXISTS (SELECT 1 FROM workspace_project_exclusions x WHERE x.workspace_id = ${projects.workspaceId} AND x.project_id = ${projects.id} AND x.user_id = ${userId}))`,
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

  async listSharedUsersInWorkspace(
    userId: string,
    workspaceId: string,
  ): Promise<SharedUser[]> {
    // То же, что listSharedUsers, но круг ограничен со-участниками ОДНОГО пространства:
    // wm1 — членство caller-а именно в workspaceId, wm2 — остальные участники того же
    // пространства (workspaceId наследуется через join wm2.workspace_id = wm1.workspace_id).
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
      .where(
        and(eq(wm1.userId, userId), eq(wm1.workspaceId, workspaceId), ne(wm2.userId, userId)),
      )
      .orderBy(asc(users.displayName));
    return rows;
  }

  // Руководители пространства проекта. Инбокс здесь не исключение: он тоже принадлежит
  // пространству, и его задачи входят в зону ответственности руководителя (спека §2).
  async listLeadUserIdsForProject(projectId: string): Promise<string[]> {
    const rows = await this.db
      .select({ userId: workspaceMembers.userId })
      .from(projects)
      .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, projects.workspaceId))
      .where(and(eq(projects.id, projectId), eq(workspaceMembers.role, 'lead')));
    return rows.map((r) => r.userId);
  }

  async listApproverUserIdsForProject(projectId: string): Promise<string[]> {
    const rows = await this.db
      .select({ userId: workspaceMembers.userId })
      .from(projects)
      .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, projects.workspaceId))
      .where(
        and(
          eq(projects.id, projectId),
          inArray(workspaceMembers.role, ['lead', 'owner']),
        ),
      );
    return rows.map((r) => r.userId);
  }

  async listLeadUserIds(workspaceId: string): Promise<string[]> {
    const rows = await this.db
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.role, 'lead')))
      .orderBy(asc(workspaceMembers.createdAt));
    return rows.map((r) => r.userId);
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
    // Избранное вычисляется по назначенным задачам, поэтому выбор пользователя хранится
    // поправкой favorite_override (db/172). Строки может ещё не быть — нужен upsert и при
    // снятии: иначе вычисленное избранное не убрать.
    if (!favorite) {
      await this.db
        .insert(projectMembers)
        .values({ projectId, userId, role: 'editor', isFavorite: false, favoriteOverride: false })
        .onDuplicateKeyUpdate({ set: { isFavorite: false, favoriteOverride: false } });
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
          favoriteOverride: true,
        })
        .onDuplicateKeyUpdate({
          set: { isFavorite: true, favoriteSortOrder: nextOrder, favoriteOverride: true },
        });
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
