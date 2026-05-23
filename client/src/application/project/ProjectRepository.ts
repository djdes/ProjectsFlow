import type { Project } from '@/domain/project/Project';
import type { ProjectMember, ProjectRole } from '@/domain/project/ProjectMembership';
import type { ProjectInvite, ProjectInviteRole } from '@/domain/project/ProjectInvite';
import type { NotificationPrefs } from '@/domain/notifications/NotificationPrefs';

// Делегирование GitHub-токена owner'а проекта Ralph-диспетчеру.
// Сам токен здесь не возвращается — только статус. Plaintext-токен получает
// диспетчер через agent-API (`pf_get_project_git_token`).
export type GitTokenDelegation = {
  readonly enabled: boolean;
  // Когда впервые включили (null если ни разу).
  readonly grantedAt: string | null;
  // Когда последний раз выключили (null после повторного enable).
  readonly revokedAt: string | null;
  // Кто разрешил (обычно = owner проекта на момент включения). null если delegation
  // ни разу не настраивали.
  readonly grantedBy: string | null;
};

export type GitTokenAccessOutcome =
  | 'ok'
  | 'not_dispatcher'
  | 'delegation_disabled'
  | 'granter_github_disconnected'
  | 'granter_not_owner_anymore';

export type GitTokenAccessLogEntry = {
  readonly accessedByUserId: string;
  readonly accessedByDisplayName: string | null;
  readonly accessedAt: string;
  readonly outcome: GitTokenAccessOutcome;
};

// Кандидат в Ralph-диспетчеры проекта: участник или admin с ≥1 активным agent-токеном.
export type DispatcherCandidate = {
  readonly userId: string;
  readonly displayName: string;
  readonly email: string;
  // null если admin не-member (для него доступ — через admin-bypass, не через role).
  readonly role: ProjectRole | null;
  readonly activeTokenCount: number;
  // True если admin — UI помечает плашкой «(admin)».
  readonly isAdmin: boolean;
  // True если member проекта. False для admin-не-member'ов.
  readonly isMember: boolean;
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
  // Делегирование GitHub-токена owner'а текущему Ralph-диспетчеру.
  // PUT — only owner; GET — any member (видеть факт «включено/выключено»);
  // access-log — only owner (личный audit).
  getGitTokenDelegation(projectId: string): Promise<GitTokenDelegation>;
  setGitTokenDelegation(projectId: string, enabled: boolean): Promise<GitTokenDelegation>;
  listGitTokenAccessLog(projectId: string): Promise<GitTokenAccessLogEntry[]>;
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
