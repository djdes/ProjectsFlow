import type { MemberTaskScope, WorkspaceTaskScope } from '../../domain/project/ProjectSharing.js';
import { DEFAULT_HOME_SCOPE, DEFAULT_LINKED_SCOPE } from '../../domain/project/ProjectSharing.js';
import {
  ProjectNotFoundError,
  ProjectSharingForbiddenError,
  ProjectSharingInvalidError,
} from '../../domain/project/errors.js';
import type { Project } from '../../domain/project/Project.js';
import type { WorkspaceKind } from '../../domain/workspace/Workspace.js';
import type { WorkspaceMember, WorkspaceRole } from '../../domain/workspace/WorkspaceMember.js';
import type { ProjectMemberRepository } from './ProjectMemberRepository.js';
import type { ProjectSharingRepository } from './ProjectSharingRepository.js';

type WorkspaceInfo = { readonly id: string; readonly name: string; readonly icon: string | null; readonly kind: WorkspaceKind };

type Deps = {
  readonly projects: { getById(id: string): Promise<Project | null> };
  readonly sharing: Pick<ProjectSharingRepository, 'getConfig' | 'saveConfig' | 'memberships'>;
  readonly workspaces: {
    getById(id: string): Promise<WorkspaceInfo | null>;
    getMembership(workspaceId: string, userId: string): Promise<WorkspaceMember | null>;
    listForUser(userId: string): Promise<ReadonlyArray<WorkspaceInfo & { readonly role: WorkspaceRole }>>;
  };
  readonly members: Pick<ProjectMemberRepository, 'listByProject' | 'findForProject'>;
  // Сайдбары участников затронутых пространств надо перечитать.
  readonly onChanged?: (projectId: string, workspaceIds: readonly string[]) => void;
};

export type ProjectSharingView = {
  readonly canManage: boolean;
  readonly homeWorkspaceId: string;
  readonly workspaces: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly icon: string | null;
    readonly isHome: boolean;
    readonly connected: boolean;
    readonly taskScope: WorkspaceTaskScope;
  }>;
  readonly members: ReadonlyArray<{
    readonly userId: string;
    readonly displayName: string;
    readonly avatarUrl: string | null;
    // Пространства проекта, где человек участник.
    readonly workspaceIds: readonly string[];
    readonly rule: MemberTaskScope | null;
  }>;
};

export type SaveProjectSharingCommand = {
  readonly workspaces: ReadonlyArray<{ readonly workspaceId: string; readonly taskScope: WorkspaceTaskScope }>;
  readonly members: ReadonlyArray<{ readonly userId: string; readonly taskScope: MemberTaskScope }>;
};

const isAdminRole = (role: WorkspaceRole | undefined): boolean => role === 'owner' || role === 'lead';

/**
 * «Доступ пространств» проекта (db/182): к каким пространствам подключён проект и кто чьи
 * задачи видит. Меняют автор проекта и owner/lead основного пространства; подключить можно
 * только командное пространство, где вы сами owner/lead.
 * См. docs/superpowers/specs/2026-11-12-shared-projects-across-workspaces-design.md.
 */
export class ManageProjectSharing {
  constructor(private readonly deps: Deps) {}

  async get(projectId: string, actorUserId: string): Promise<ProjectSharingView> {
    const project = await this.requireProject(projectId, actorUserId);
    const canManage = await this.canManage(project, actorUserId);
    const config = await this.deps.sharing.getConfig(projectId);
    const scopes = new Map((config?.workspaces ?? []).map((row) => [row.workspaceId, row.taskScope] as const));
    const connectedIds = [project.workspaceId, ...[...scopes.keys()].filter((id) => id !== project.workspaceId)];
    const candidates = canManage
      ? (await this.deps.workspaces.listForUser(actorUserId)).filter((w) => w.kind === 'team' && isAdminRole(w.role))
      : [];
    const ids = [...new Set([...connectedIds, ...candidates.map((w) => w.id)])];
    const infos = new Map<string, WorkspaceInfo>();
    for (const w of candidates) infos.set(w.id, w);
    for (const id of ids) {
      if (!infos.has(id)) {
        const info = await this.deps.workspaces.getById(id);
        if (info) infos.set(id, info);
      }
    }
    const workspaces = ids.flatMap((id) => {
      const info = infos.get(id);
      if (!info) return [];
      const isHome = id === project.workspaceId;
      const connected = isHome || scopes.has(id);
      return [{
        id,
        name: info.name,
        icon: info.icon,
        isHome,
        connected,
        taskScope: scopes.get(id) ?? (isHome ? DEFAULT_HOME_SCOPE : DEFAULT_LINKED_SCOPE),
      }];
    });

    const people = await this.deps.members.listByProject(projectId);
    const memberships = await this.deps.sharing.memberships(
      people.map((m) => m.userId),
      [{ projectId, workspaceIds: connectedIds }],
    );
    const rules = new Map((config?.members ?? []).map((row) => [row.userId, row.taskScope] as const));
    return {
      canManage,
      homeWorkspaceId: project.workspaceId,
      workspaces,
      members: people.map((m) => ({
        userId: m.userId,
        displayName: m.user.displayName,
        avatarUrl: m.user.avatarUrl ?? null,
        workspaceIds: memberships.filter((x) => x.userId === m.userId).map((x) => x.workspaceId),
        rule: rules.get(m.userId) ?? null,
      })),
    };
  }

  async save(projectId: string, actorUserId: string, input: SaveProjectSharingCommand): Promise<ProjectSharingView> {
    const project = await this.requireProject(projectId, actorUserId);
    if (!(await this.canManage(project, actorUserId))) throw new ProjectSharingForbiddenError();
    const config = await this.deps.sharing.getConfig(projectId);
    const before = new Set((config?.workspaces ?? []).map((row) => row.workspaceId));

    const desired = new Map<string, WorkspaceTaskScope>();
    for (const row of input.workspaces) desired.set(row.workspaceId, row.taskScope);
    if (!desired.has(project.workspaceId)) {
      const homeRule = config?.workspaces.find((row) => row.workspaceId === project.workspaceId)?.taskScope;
      desired.set(project.workspaceId, homeRule ?? DEFAULT_HOME_SCOPE);
    }
    // Новое подключение — только командное пространство, где актор сам owner/lead.
    for (const workspaceId of desired.keys()) {
      if (workspaceId === project.workspaceId || before.has(workspaceId)) continue;
      const [workspace, membership] = await Promise.all([
        this.deps.workspaces.getById(workspaceId),
        this.deps.workspaces.getMembership(workspaceId, actorUserId),
      ]);
      if (!workspace || workspace.kind !== 'team') {
        throw new ProjectSharingInvalidError('Подключить можно только командное пространство.');
      }
      if (!isAdminRole(membership?.role)) {
        throw new ProjectSharingInvalidError('Подключить можно пространство, где вы владелец или руководитель.');
      }
    }
    const workspaceIds = [...desired.keys()];
    const onlyKnown = <T extends WorkspaceTaskScope | MemberTaskScope>(scope: T): T =>
      scope.kind === 'selected' ? ({ ...scope, from: scope.from.filter((id) => workspaceIds.includes(id)) } as T) : scope;

    // Персональные правила — только тем, у кого будет доступ к проекту.
    const requested = new Map(input.members.map((m) => [m.userId, m.taskScope] as const));
    const access = await this.deps.sharing.memberships([...requested.keys()], [{ projectId, workspaceIds }]);
    const withAccess = new Set(access.map((m) => m.userId));
    const members = [...requested.entries()]
      .filter(([userId]) => withAccess.has(userId))
      .map(([userId, taskScope]) => ({ userId, taskScope: onlyKnown(taskScope) }));

    await this.deps.sharing.saveConfig(projectId, {
      actorUserId,
      workspaces: workspaceIds.map((workspaceId) => ({ workspaceId, taskScope: onlyKnown(desired.get(workspaceId)!) })),
      members,
    });
    this.deps.onChanged?.(projectId, [...new Set([project.workspaceId, ...before, ...workspaceIds])]);
    return this.get(projectId, actorUserId);
  }

  private async requireProject(projectId: string, actorUserId: string): Promise<Project> {
    const project = await this.deps.projects.getById(projectId);
    if (!project) throw new ProjectNotFoundError();
    if (project.isInbox) throw new ProjectSharingInvalidError('«Входящие» нельзя подключать к другим пространствам.');
    // Смотреть настройки может любой участник проекта; посторонним проект не раскрываем.
    if (!(await this.deps.members.findForProject(projectId, actorUserId))) throw new ProjectNotFoundError();
    return project;
  }

  private async canManage(project: Project, actorUserId: string): Promise<boolean> {
    // Автор проекта управляет доступом, пока он участник основного пространства: гость через
    // подключённое пространство (например, его убрали из основного) — уже нет.
    if (project.ownerId === actorUserId) {
      const access = await this.deps.members.findForProject(project.id, actorUserId);
      if (access && !access.guest) return true;
    }
    const membership = await this.deps.workspaces.getMembership(project.workspaceId, actorUserId);
    return isAdminRole(membership?.role);
  }
}
