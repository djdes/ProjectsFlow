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
  deriveSharedMembership,
  type ProjectAccessRow,
  type ProjectWorkspaceAccessRow,
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

type SharedWorkspace = { id: string; name: string; icon: string | null };

const isAdminRole = (role: string): boolean => role === 'owner' || role === 'lead';

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

  // Явно скрыт галочкой: членство в пространствах проекта есть, а доступа нет (скрыт в
  // основном пространстве или во всех подключённых, где состоит).
  async isProjectHidden(projectId: string, userId: string): Promise<boolean> {
    // Быстрый путь (один запрос, как без подключений): скрыт галочкой в основном
    // пространстве, где он не owner/lead. Подключённые пространства смотрим, только если есть.
    const [quick] = await this.db
      .select({
        isInbox: projects.isInbox,
        // Имена колонок — явно с таблицей: в выборке из одной таблицы drizzle пишет их без
        // неё, и внутри подзапроса `workspace_id` связался бы с таблицей подзапроса.
        shared: sql<number>`EXISTS (SELECT 1 FROM project_workspace_access a WHERE a.project_id = projects.id AND a.workspace_id <> projects.workspace_id)`,
        homeHidden: sql<number>`EXISTS (SELECT 1 FROM workspace_project_exclusions x INNER JOIN workspace_members wm ON wm.workspace_id = x.workspace_id AND wm.user_id = x.user_id WHERE x.project_id = projects.id AND x.workspace_id = projects.workspace_id AND x.user_id = ${userId} AND wm.role NOT IN ('owner', 'lead'))`,
      })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!quick || quick.isInbox) return false;
    if (!Number(quick.shared)) return Boolean(Number(quick.homeHidden));
    const project = await this.getProjectAccessRow(projectId);
    if (!project) return false;
    const rows = await this.accessRows(project, [userId]);
    const own = rows.get(userId) ?? [];
    return own.length > 0 && deriveSharedMembership(project, userId, own) === null;
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

  // Подключённые пространства проекта (db/182), без строки-правила основного.
  private async linkedWorkspaceIds(project: Pick<ProjectAccessRow, 'id' | 'workspaceId'>): Promise<string[]> {
    const rows = await this.db
      .select({ workspaceId: projectWorkspaceAccess.workspaceId })
      .from(projectWorkspaceAccess)
      .where(
        and(
          eq(projectWorkspaceAccess.projectId, project.id),
          ne(projectWorkspaceAccess.workspaceId, project.workspaceId),
        ),
      );
    return rows.map((row) => row.workspaceId);
  }

  // Членства юзеров в пространствах проекта (основное + подключённые) со скрытием галочкой.
  private async accessRows(
    project: ProjectAccessRow,
    userIds: readonly string[],
  ): Promise<Map<string, ProjectWorkspaceAccessRow[]>> {
    const result = new Map<string, ProjectWorkspaceAccessRow[]>();
    const users = [...new Set(userIds)];
    if (users.length === 0) return result;
    const workspaceIds = [project.workspaceId, ...(await this.linkedWorkspaceIds(project))];
    const [members, exclusions] = await Promise.all([
      this.db
        .select({
          workspaceId: workspaceMembers.workspaceId,
          userId: workspaceMembers.userId,
          role: workspaceMembers.role,
          createdAt: workspaceMembers.createdAt,
        })
        .from(workspaceMembers)
        .where(and(inArray(workspaceMembers.workspaceId, workspaceIds), inArray(workspaceMembers.userId, users))),
      this.db
        .select({ workspaceId: workspaceProjectExclusions.workspaceId, userId: workspaceProjectExclusions.userId })
        .from(workspaceProjectExclusions)
        .where(
          and(eq(workspaceProjectExclusions.projectId, project.id), inArray(workspaceProjectExclusions.userId, users)),
        ),
    ]);
    const excluded = new Set(exclusions.map((x) => `${x.workspaceId}|${x.userId}`));
    for (const m of members) {
      const list = result.get(m.userId) ?? [];
      list.push({
        workspaceId: m.workspaceId,
        userId: m.userId,
        role: m.role as ProjectRole,
        createdAt: m.createdAt,
        excluded: excluded.has(`${m.workspaceId}|${m.userId}`),
      });
      result.set(m.userId, list);
    }
    return result;
  }

  async findForProject(projectId: string, userId: string): Promise<ProjectMembership | null> {
    // Быстрый путь — как без подключённых пространств: членство в основном пространстве
    // решает всё (см. deriveSharedMembership). Подключённые смотрим, только если его нет.
    const rows = await this.db
      .select({
        id: projects.id,
        workspaceId: projects.workspaceId,
        ownerId: projects.ownerId,
        isInbox: projects.isInbox,
        createdAt: projects.createdAt,
        wmRole: workspaceMembers.role,
        wmCreatedAt: workspaceMembers.createdAt,
        excluded: sql<number>`EXISTS (SELECT 1 FROM workspace_project_exclusions x WHERE x.workspace_id = ${projects.workspaceId} AND x.project_id = ${projects.id} AND x.user_id = ${userId})`,
        shared: sql<number>`EXISTS (SELECT 1 FROM project_workspace_access a WHERE a.project_id = ${projects.id} AND a.workspace_id <> ${projects.workspaceId})`,
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
    const project = { id: r.id, workspaceId: r.workspaceId, ownerId: r.ownerId, isInbox: r.isInbox, createdAt: r.createdAt };
    const wsMember =
      r.wmRole !== null && r.wmCreatedAt !== null
        ? { userId, role: r.wmRole as ProjectRole, createdAt: r.wmCreatedAt }
        : null;
    if (project.isInbox || wsMember || !Number(r.shared)) {
      return deriveMembership(project, userId, wsMember, Boolean(r.excluded));
    }
    const access = await this.accessRows(project, [userId]);
    return deriveSharedMembership(project, userId, access.get(userId) ?? []);
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
    // (ленивые строки — left join). Человек из нескольких пространств — одной строкой; роль
    // и скрытие галочкой — по deriveSharedMembership (гости — не выше editor).
    const workspaceIds = [project.workspaceId, ...(await this.linkedWorkspaceIds(project))];
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
      .where(workspaceIds.length === 1 ? eq(workspaceMembers.workspaceId, project.workspaceId) : inArray(workspaceMembers.workspaceId, workspaceIds))
      .orderBy(asc(workspaceMembers.createdAt));
    const byUser = new Map<string, Array<(typeof all)[number]>>();
    for (const r of all) {
      const list = byUser.get(r.member.userId) ?? [];
      list.push(r);
      byUser.set(r.member.userId, list);
    }
    const out: ProjectMemberWithUser[] = [];
    for (const [userId, list] of byUser) {
      const membership = deriveSharedMembership(
        project,
        userId,
        list.map((r) => ({
          workspaceId: r.member.workspaceId,
          userId,
          role: r.member.role as ProjectRole,
          createdAt: r.member.createdAt,
          excluded: Boolean(r.excluded),
        })),
      );
      if (!membership) continue;
      const first = list[0]!;
      out.push({
        ...membership,
        user: toUser(first.user),
        notificationPrefs: parseJsonCol<NotificationPrefs | null>(first.prefs, null),
      });
    }
    return out;
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
  // пространство или гостем через подключённое (db/182, роль — deriveSharedMembership).
  // В разрезе пространства W: проекты основного W и подключённые к W, где членство в W не
  // скрыто галочкой. Без W — все проекты всех пространств юзера, по строке на проект.
  // LEFT JOIN workspace_members (не INNER!) — иначе свой inbox выпадал бы, если владельца
  // убрали из пространства, где inbox был создан. Per-member настройки — left join к ленивым
  // строкам project_members.
  private async listProjectsWhere(
    userId: string,
    workspaceId: string | undefined,
  ): Promise<ProjectWithRole[]> {
    // Гостевой путь: подключения проектов к пространствам юзера. Строки-правила основного
    // пространства тоже сюда попадают — их отсекаем ниже, когда известен проект.
    const guestRows = await this.db
      .select({
        projectId: projectWorkspaceAccess.projectId,
        workspaceId: projectWorkspaceAccess.workspaceId,
        role: workspaceMembers.role,
        createdAt: workspaceMembers.createdAt,
      })
      .from(projectWorkspaceAccess)
      .innerJoin(
        workspaceMembers,
        and(eq(workspaceMembers.workspaceId, projectWorkspaceAccess.workspaceId), eq(workspaceMembers.userId, userId)),
      );
    const guestProjectIds = [
      ...new Set(
        guestRows.filter((row) => workspaceId === undefined || row.workspaceId === workspaceId).map((row) => row.projectId),
      ),
    ];
    const visible = or(
      and(eq(projects.isInbox, false), isNotNull(workspaceMembers.userId)),
      and(eq(projects.isInbox, true), eq(projects.ownerId, userId)),
    );
    const own = workspaceId === undefined ? visible : and(visible, eq(projects.workspaceId, workspaceId));
    const where =
      guestProjectIds.length > 0 ? or(own, and(eq(projects.isInbox, false), inArray(projects.id, guestProjectIds))) : own;
    const rows = await this.db
      .select({
        project: projects,
        wsRole: workspaceMembers.role,
        wsCreatedAt: workspaceMembers.createdAt,
        excluded: sql<number>`EXISTS (SELECT 1 FROM workspace_project_exclusions x WHERE x.workspace_id = ${projects.workspaceId} AND x.project_id = ${projects.id} AND x.user_id = ${userId})`,
        memberCount: sql<number>`(SELECT COUNT(*) FROM workspace_members wm2 WHERE wm2.workspace_id = ${projects.workspaceId} AND (wm2.role IN ('owner', 'lead') OR NOT EXISTS (SELECT 1 FROM workspace_project_exclusions x WHERE x.workspace_id = wm2.workspace_id AND x.project_id = ${projects.id} AND x.user_id = wm2.user_id)))`,
        // deleted_at IS NULL (db/134): задачи из корзины не должны раздувать счётчик.
        taskCount: sql<number>`(SELECT COUNT(*) FROM tasks t WHERE t.project_id = ${projects.id} AND t.deleted_at IS NULL)`,
        // Избранное ВЫЧИСЛЯЕМОЕ: проект в избранном, если у пользователя есть незавершённая
        // назначенная задача в нём. Колонки db/040 is_favorite/favorite_sort_order больше не
        // читаем; ручная поправка из меню проекта — favorite_override (db/172), см. ниже.
        favoriteOverride: projectMembers.favoriteOverride,
        isFavorite: sql<number>`EXISTS (SELECT 1 FROM tasks tf WHERE tf.project_id = ${projects.id} AND tf.assignee_user_id = ${userId} AND tf.status <> 'done' AND tf.deleted_at IS NULL)`,
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
      .where(where)
      .orderBy(sql`COALESCE(${projectMembers.sortOrder}, 0)`, asc(projects.createdAt));

    const guestExclusions =
      guestProjectIds.length > 0
        ? await this.db
            .select({ projectId: workspaceProjectExclusions.projectId, workspaceId: workspaceProjectExclusions.workspaceId })
            .from(workspaceProjectExclusions)
            .where(
              and(
                eq(workspaceProjectExclusions.userId, userId),
                inArray(workspaceProjectExclusions.projectId, guestProjectIds),
              ),
            )
        : [];
    const guestExcluded = new Set(guestExclusions.map((x) => `${x.projectId}|${x.workspaceId}`));

    const result: Array<{ row: (typeof rows)[number]; membership: ProjectMembership }> = [];
    for (const r of rows) {
      const home: ProjectWorkspaceAccessRow | null =
        r.wsRole !== null && r.wsCreatedAt !== null
          ? {
              workspaceId: r.project.workspaceId,
              userId,
              role: r.wsRole as ProjectRole,
              createdAt: r.wsCreatedAt,
              excluded: Boolean(r.excluded),
            }
          : null;
      const linked: ProjectWorkspaceAccessRow[] = guestRows
        .filter((g) => g.projectId === r.project.id && g.workspaceId !== r.project.workspaceId)
        .map((g) => ({
          workspaceId: g.workspaceId,
          userId,
          role: g.role as ProjectRole,
          createdAt: g.createdAt,
          excluded: guestExcluded.has(`${g.projectId}|${g.workspaceId}`),
        }));
      const membership = deriveSharedMembership(r.project, userId, home ? [home, ...linked] : linked);
      if (!membership) continue;
      if (workspaceId !== undefined && r.project.workspaceId !== workspaceId) {
        // Подключённый к W проект: виден в W, если членство в W не скрыто галочкой.
        const inW = linked.find((g) => g.workspaceId === workspaceId);
        if (!inW || (inW.excluded && !isAdminRole(inW.role))) continue;
      }
      result.push({ row: r, membership });
    }

    const sharing = await this.sharingOf(result.map(({ row }) => row.project));
    return result.map(({ row: r, membership }) => ({
      ...toProject(r.project),
      role: membership.role,
      ...(membership.guest ? { guest: true } : {}),
      memberCount: r.project.isInbox ? 1 : (sharing.memberCounts.get(r.project.id) ?? Number(r.memberCount)),
      taskCount: Number(r.taskCount),
      // Inbox никогда не попадает в избранное (как и раньше — его нельзя было отметить).
      // Ручная поправка пользователя (закрепить/скрыть) важнее вычисленного значения.
      isFavorite: !r.project.isInbox && (r.favoriteOverride ?? Boolean(r.isFavorite)),
      // Ручной порядок избранного убран — поле оставлено в типе как 0 (клиент больше не сортирует по нему).
      favoriteSortOrder: 0,
      sharedWorkspaces: sharing.workspaces.get(r.project.id) ?? [],
    }));
  }

  // Общие проекты (db/182): их пространства (основное первым) — для значка «общий» и подписей
  // задач — и число участников по всем пространствам. Проекты без подключённых пространств в
  // ответ не попадают: для них счётчик считает основной запрос.
  private async sharingOf(
    list: ReadonlyArray<Pick<ProjectAccessRow, 'id' | 'workspaceId' | 'ownerId' | 'isInbox' | 'createdAt'>>,
  ): Promise<{ workspaces: Map<string, SharedWorkspace[]>; memberCounts: Map<string, number> }> {
    const workspacesByProject = new Map<string, SharedWorkspace[]>();
    const memberCounts = new Map<string, number>();
    const candidates = list.filter((project) => !project.isInbox);
    if (candidates.length === 0) return { workspaces: workspacesByProject, memberCounts };
    const access = await this.db
      .select({ projectId: projectWorkspaceAccess.projectId, workspaceId: projectWorkspaceAccess.workspaceId })
      .from(projectWorkspaceAccess)
      .where(inArray(projectWorkspaceAccess.projectId, candidates.map((project) => project.id)));
    const linkedByProject = new Map<string, string[]>();
    for (const project of candidates) {
      const linked = access
        .filter((row) => row.projectId === project.id && row.workspaceId !== project.workspaceId)
        .map((row) => row.workspaceId);
      if (linked.length > 0) linkedByProject.set(project.id, linked);
    }
    if (linkedByProject.size === 0) return { workspaces: workspacesByProject, memberCounts };
    const shared = candidates.filter((project) => linkedByProject.has(project.id));
    const workspaceIds = [
      ...new Set(shared.flatMap((project) => [project.workspaceId, ...linkedByProject.get(project.id)!])),
    ];
    const [infos, members, exclusions] = await Promise.all([
      this.db
        .select({ id: workspaces.id, name: workspaces.name, icon: workspaces.icon })
        .from(workspaces)
        .where(inArray(workspaces.id, workspaceIds)),
      this.db
        .select({
          workspaceId: workspaceMembers.workspaceId,
          userId: workspaceMembers.userId,
          role: workspaceMembers.role,
          createdAt: workspaceMembers.createdAt,
        })
        .from(workspaceMembers)
        .where(inArray(workspaceMembers.workspaceId, workspaceIds)),
      this.db
        .select({
          projectId: workspaceProjectExclusions.projectId,
          workspaceId: workspaceProjectExclusions.workspaceId,
          userId: workspaceProjectExclusions.userId,
        })
        .from(workspaceProjectExclusions)
        .where(inArray(workspaceProjectExclusions.projectId, shared.map((project) => project.id))),
    ]);
    const excluded = new Set(exclusions.map((x) => `${x.projectId}|${x.workspaceId}|${x.userId}`));
    for (const project of shared) {
      const ids = [project.workspaceId, ...linkedByProject.get(project.id)!];
      workspacesByProject.set(
        project.id,
        ids.flatMap((id) => {
          const info = infos.find((w) => w.id === id);
          return info ? [{ id: info.id, name: info.name, icon: info.icon ?? null }] : [];
        }),
      );
      const byUser = new Map<string, ProjectWorkspaceAccessRow[]>();
      for (const m of members) {
        if (!ids.includes(m.workspaceId)) continue;
        const rows = byUser.get(m.userId) ?? [];
        rows.push({
          workspaceId: m.workspaceId,
          userId: m.userId,
          role: m.role as ProjectRole,
          createdAt: m.createdAt,
          excluded: excluded.has(`${project.id}|${m.workspaceId}|${m.userId}`),
        });
        byUser.set(m.userId, rows);
      }
      let count = 0;
      for (const [memberId, rows] of byUser) {
        if (deriveSharedMembership(project, memberId, rows)) count += 1;
      }
      memberCounts.set(project.id, count);
    }
    return { workspaces: workspacesByProject, memberCounts };
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

  async listApproverUserIdsForProject(projectId: string, originWorkspaceId?: string | null): Promise<string[]> {
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
    const ids = rows.map((r) => r.userId);
    if (!originWorkspaceId) return ids;
    // Общий проект (db/182): задачу из подключённого пространства принимают и его
    // руководители. Пространство должно быть подключено сейчас (иначе задача — основного).
    const origin = await this.db
      .select({ userId: workspaceMembers.userId })
      .from(projectWorkspaceAccess)
      .innerJoin(projects, eq(projects.id, projectWorkspaceAccess.projectId))
      .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, projectWorkspaceAccess.workspaceId))
      .where(
        and(
          eq(projectWorkspaceAccess.projectId, projectId),
          eq(projectWorkspaceAccess.workspaceId, originWorkspaceId),
          ne(projectWorkspaceAccess.workspaceId, projects.workspaceId),
          inArray(workspaceMembers.role, ['lead', 'owner']),
        ),
      );
    return [...new Set([...ids, ...origin.map((r) => r.userId)])];
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
