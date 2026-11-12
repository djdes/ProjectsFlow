import type { MemberTaskScope, ProjectSharing, WorkspaceTaskScope } from '../../domain/project/ProjectSharing.js';
import type { WorkspaceRole } from '../../domain/workspace/WorkspaceMember.js';

// Один проект в нескольких пространствах (db/182). См.
// docs/superpowers/specs/2026-11-12-shared-projects-across-workspaces-design.md.

// Общий проект с автором и диспетчером: оба видят все задачи проекта.
export type LoadedProjectSharing = ProjectSharing & {
  readonly creatorUserId: string;
  readonly dispatcherUserId?: string | null;
};

export type ProjectSharingConfig = {
  readonly projectId: string;
  readonly homeWorkspaceId: string;
  // Автор проекта (projects.owner_id).
  readonly creatorUserId: string;
  // Подключённые пространства и правило основного (если менялось).
  readonly workspaces: ReadonlyArray<{ readonly workspaceId: string; readonly taskScope: WorkspaceTaskScope }>;
  readonly members: ReadonlyArray<{ readonly userId: string; readonly taskScope: MemberTaskScope }>;
};

export type SaveProjectSharingInput = {
  readonly actorUserId: string;
  // Полный набор: пространства, которых нет в списке (кроме основного), отключаются.
  readonly workspaces: ReadonlyArray<{ readonly workspaceId: string; readonly taskScope: WorkspaceTaskScope }>;
  // Полный набор персональных правил: остальные удаляются.
  readonly members: ReadonlyArray<{ readonly userId: string; readonly taskScope: MemberTaskScope }>;
};

// Членство человека в пространстве проекта: роль и «скрыт галочкой» (exclusions по пространству).
export type ProjectWorkspaceMembership = {
  readonly workspaceId: string;
  readonly userId: string;
  readonly role: WorkspaceRole;
  readonly excluded: boolean;
};

export interface ProjectSharingRepository {
  // Правила общих проектов из списка — только тех, где кроме основного подключено хоть одно
  // пространство. Остальные проекты в ответе отсутствуют (быстрый путь).
  loadMany(projectIds: readonly string[]): Promise<Map<string, LoadedProjectSharing>>;
  // Пространства проекта: основное и подключённые.
  workspaceIdsOf(projectId: string): Promise<string[]>;
  // Членства людей в пространствах проектов (для видимости задач и аудитории уведомлений).
  memberships(
    userIds: readonly string[],
    projectWorkspaces: ReadonlyArray<{ readonly projectId: string; readonly workspaceIds: readonly string[] }>,
  ): Promise<Array<ProjectWorkspaceMembership & { readonly projectId: string }>>;
  getConfig(projectId: string): Promise<ProjectSharingConfig | null>;
  // Сохраняет настройки. Задачи отключённых пространств становятся задачами основного.
  saveConfig(projectId: string, input: SaveProjectSharingInput): Promise<{ readonly removedWorkspaceIds: string[] }>;
}
