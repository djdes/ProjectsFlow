import { canSeeTask, type ProjectSharing } from '../../domain/project/ProjectSharing.js';
import type {
  LoadedProjectSharing,
  ProjectSharingRepository,
  ProjectWorkspaceMembership,
} from './ProjectSharingRepository.js';

// Минимальный срез задачи для проверки видимости — совпадает с доменной Task.
export type VisibleTaskLike = {
  readonly projectId: string;
  readonly createdBy: string | null;
  readonly assignee: { readonly userId: string };
  readonly originWorkspaceId?: string | null;
};

type Deps = {
  readonly sharing: Pick<ProjectSharingRepository, 'loadMany' | 'memberships'>;
  // Пространство текущего запроса (X-Workspace-Id): доска и списки показывают его правило.
  // null — контекста нет (Telegram, MCP, фоновые задачи): объединение правил.
  readonly currentWorkspaceId?: (userId: string) => string | null;
  // Системный админ видит всё (как и admin-bypass доступа к проектам).
  readonly isSystemAdmin?: (userId: string) => Promise<boolean>;
};

type SharingWithCreator = LoadedProjectSharing;

/**
 * Видимость задач общих проектов (db/182). Проекты без подключённых пространств идут быстрым
 * путём — фильтр их не трогает. См. docs/superpowers/specs/2026-11-12-shared-projects-across-workspaces-design.md.
 */
export class TaskVisibility {
  constructor(private readonly deps: Deps) {}

  // Задачи, которые человек видит. workspaceId: undefined — пространство запроса; null — без
  // контекста (объединение правил всех его пространств проекта).
  async filterTasks<T extends VisibleTaskLike>(
    userId: string,
    list: readonly T[],
    opts: { readonly workspaceId?: string | null } = {},
  ): Promise<T[]> {
    if (list.length === 0) return [];
    const sharing = await this.deps.sharing.loadMany(list.map((task) => task.projectId));
    if (sharing.size === 0) return [...list];
    if (await this.deps.isSystemAdmin?.(userId)) return [...list];
    const memberships = await this.deps.sharing.memberships([userId], projectWorkspaces(sharing));
    const context = opts.workspaceId !== undefined ? opts.workspaceId : (this.deps.currentWorkspaceId?.(userId) ?? null);
    return list.filter((task) => {
      const projectSharing = sharing.get(task.projectId);
      return !projectSharing || visibleTo(projectSharing, memberships, userId, context, task);
    });
  }

  async canSee(userId: string, task: VisibleTaskLike): Promise<boolean> {
    return (await this.filterTasks(userId, [task], { workspaceId: null })).length === 1;
  }

  // Кому из списка показывать событие/уведомление по задаче.
  async filterAudience(task: VisibleTaskLike, userIds: readonly string[]): Promise<string[]> {
    if (userIds.length === 0) return [];
    const sharing = await this.deps.sharing.loadMany([task.projectId]);
    const projectSharing = sharing.get(task.projectId);
    if (!projectSharing) return [...userIds];
    const memberships = await this.deps.sharing.memberships(userIds, projectWorkspaces(sharing));
    return userIds.filter((userId) => visibleTo(projectSharing, memberships, userId, null, task));
  }

  // Задачи, которые видит пространство целиком (групповые сводки): только правило пространства.
  async filterForWorkspace<T extends VisibleTaskLike>(workspaceId: string, list: readonly T[]): Promise<T[]> {
    if (list.length === 0) return [];
    const sharing = await this.deps.sharing.loadMany(list.map((task) => task.projectId));
    if (sharing.size === 0) return [...list];
    return list.filter((task) => {
      const projectSharing = sharing.get(task.projectId);
      if (!projectSharing) return true;
      if (!projectSharing.workspaces.has(workspaceId)) return false;
      return canSeeTask(
        { ...projectSharing, members: new Map() },
        { userId: '', viewerWorkspaceId: workspaceId, memberWorkspaceIds: [workspaceId], isAdmin: false },
        { createdBy: task.createdBy, assigneeUserId: task.assignee.userId, originWorkspaceId: task.originWorkspaceId },
      );
    });
  }
}

function projectWorkspaces(
  sharing: ReadonlyMap<string, SharingWithCreator>,
): Array<{ projectId: string; workspaceIds: string[] }> {
  return [...sharing.values()].map((s) => ({ projectId: s.projectId, workspaceIds: [...s.workspaces.keys()] }));
}

function visibleTo(
  sharing: SharingWithCreator,
  memberships: ReadonlyArray<ProjectWorkspaceMembership & { readonly projectId: string }>,
  userId: string,
  contextWorkspaceId: string | null,
  task: VisibleTaskLike,
): boolean {
  const own = memberships.filter(
    (m) =>
      m.projectId === sharing.projectId &&
      m.userId === userId &&
      (!m.excluded || m.role === 'owner' || m.role === 'lead'),
  );
  const memberWorkspaceIds = own.map((m) => m.workspaceId);
  const homeRole = own.find((m) => m.workspaceId === sharing.homeWorkspaceId)?.role;
  // Автор проекта, руководители основного пространства и диспетчер (воркер исполняет все
  // задачи проекта) видят всё.
  const isAdmin =
    sharing.creatorUserId === userId ||
    sharing.dispatcherUserId === userId ||
    homeRole === 'owner' ||
    homeRole === 'lead';
  const viewerWorkspaceId =
    contextWorkspaceId !== null && memberWorkspaceIds.includes(contextWorkspaceId) ? contextWorkspaceId : null;
  return canSeeTask(
    sharing,
    { userId, viewerWorkspaceId, memberWorkspaceIds, isAdmin },
    { createdBy: task.createdBy, assigneeUserId: task.assignee.userId, originWorkspaceId: task.originWorkspaceId },
  );
}
