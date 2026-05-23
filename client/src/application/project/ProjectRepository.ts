import type { Project } from '@/domain/project/Project';
import type { ProjectMember, ProjectRole } from '@/domain/project/ProjectMembership';
import type { ProjectInvite, ProjectInviteRole } from '@/domain/project/ProjectInvite';
import type { NotificationPrefs } from '@/domain/notifications/NotificationPrefs';

// Кандидат в Ralph-диспетчеры проекта: участник с ≥1 активным agent-токеном.
export type DispatcherCandidate = {
  readonly userId: string;
  readonly displayName: string;
  readonly email: string;
  readonly role: ProjectRole;
  readonly activeTokenCount: number;
};

export type CreateProjectInput = {
  readonly name: string;
};

// Patch-семантика: undefined = поле не меняется, null = очистить, string = новое значение.
export type UpdateProjectInput = {
  readonly name?: string;
  readonly gitRepoUrl?: string | null;
  readonly kbRepoFullName?: string | null;
};

export type CreateInviteInput = {
  readonly role: ProjectInviteRole;
  readonly email: string | null;
};

// Результат проверки: используется ли тот же git-репо в чужом проекте.
export type GitCollision = {
  readonly exists: boolean;
  readonly projectId?: string;
  readonly projectName?: string;
};

export interface ProjectRepository {
  list(): Promise<Project[]>;
  getById(id: string): Promise<Project | null>;
  // Inbox-проект юзера. Создаётся лениво при первом обращении на сервере.
  getInbox(): Promise<Project>;
  create(input: CreateProjectInput): Promise<Project>;
  update(id: string, patch: UpdateProjectInput): Promise<Project>;
  // Безвозвратное удаление проекта (owner-only, инбокс запрещён). Каскадно чистит
  // все child-данные (задачи, KB, секреты, финансы и т.д.) — подробности
  // на серверном DeleteProject use-case.
  delete(id: string): Promise<void>;
  // Ralph-диспетчер проекта: кто автономно выполняет задачи через MCP /loop.
  // listDispatcherCandidates — кого МОЖНО назначить (участники с ≥1 активным
  // agent-токеном); setDispatcher — назначить/снять (owner-only).
  listDispatcherCandidates(projectId: string): Promise<DispatcherCandidate[]>;
  setDispatcher(projectId: string, userId: string | null): Promise<Project>;
  // Персональная пересортировка сайдбара: полный список id в желаемом порядке.
  reorder(orderedIds: readonly string[]): Promise<void>;

  // Multi-tenancy: members + invites. Owner-only операции упадут 403 на сервере.
  listMembers(projectId: string): Promise<ProjectMember[]>;
  updateMemberRole(
    projectId: string,
    userId: string,
    role: Exclude<ProjectRole, 'owner'>,
  ): Promise<void>;
  removeMember(projectId: string, userId: string): Promise<void>;
  transferOwnership(projectId: string, toUserId: string): Promise<void>;
  listInvites(projectId: string): Promise<ProjectInvite[]>;
  createInvite(projectId: string, input: CreateInviteInput): Promise<ProjectInvite>;
  deleteInvite(projectId: string, inviteId: string): Promise<void>;

  // Git-collision → join-request: проверка совпадения репо + заявка на вступление +
  // её разрешение владельцем (accept/decline).
  checkGitCollision(gitRepoUrl: string): Promise<GitCollision>;
  requestJoin(projectId: string): Promise<void>;
  resolveJoinRequest(requestId: string, accept: boolean): Promise<void>;

  // Пер-участниковые настройки email-оповещений (свои, по проекту).
  getNotificationPrefs(projectId: string): Promise<NotificationPrefs>;
  setNotificationPrefs(projectId: string, prefs: NotificationPrefs): Promise<NotificationPrefs>;
}
