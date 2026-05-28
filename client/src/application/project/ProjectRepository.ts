import type { Project } from '@/domain/project/Project';
import type { ProjectMember, ProjectRole } from '@/domain/project/ProjectMembership';
import type { ProjectInvite, ProjectInviteRole } from '@/domain/project/ProjectInvite';
import type { NotificationPrefs } from '@/domain/notifications/NotificationPrefs';

// v0.15: per-member opt-in. У каждого члена проекта своя независимая делегация.
// `mine` — статус CALLER-а в этом проекте. `all` — видно только owner'у:
// полный список членов проекта с их статусами + github-логинами + sort'ом
// (owner первым, потом по displayName ASC). Не-owner видит `all=[]`.
export type GitTokenDelegationMember = {
  readonly granterUserId: string;
  readonly displayName: string;
  // null если у юзера не подключён GitHub (его токен взять нельзя).
  readonly githubLogin: string | null;
  readonly enabled: boolean;
  readonly grantedAt: string | null;
  readonly revokedAt: string | null;
  readonly isOwner: boolean;
};

export type GitTokenDelegationStatus = {
  // Статус ТЕКУЩЕГО юзера (caller'а). null если caller — не member проекта.
  readonly mine: {
    readonly enabled: boolean;
    readonly grantedAt: string | null;
    readonly revokedAt: string | null;
  } | null;
  // Полный список членов с их статусами. Owner-only; не-owner получает [].
  readonly all: GitTokenDelegationMember[];
};

export type GitTokenAccessOutcome =
  | 'ok'
  | 'not_dispatcher'
  | 'delegation_disabled'
  | 'granter_github_disconnected'
  | 'granter_not_owner_anymore'
  | 'no_eligible_grantor';

// v0.16+: context — «для чего брали токен». NULL для legacy-записей.
export type GitTokenAccessContext =
  | 'git_token_fetch'
  | 'link_commit'
  | 'sync_commits'
  | 'kb_write';

export type GitTokenAccessLogEntry = {
  readonly accessedByUserId: string;
  readonly accessedByDisplayName: string | null;
  readonly accessedAt: string;
  readonly outcome: GitTokenAccessOutcome;
  readonly context: GitTokenAccessContext | null;
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
  // v0.15: per-member opt-in. GET возвращает `mine` (статус caller'а) + `all`
  // (полный список членов, только для owner-а). PUT включает/выключает ОДНУ
  // делегацию: без granterUserId — caller's own, с granterUserId — admin-on-behalf.
  // access-log — только для owner'а.
  getGitTokenDelegation(projectId: string): Promise<GitTokenDelegationStatus>;
  setGitTokenDelegation(
    projectId: string,
    enabled: boolean,
    granterUserId?: string,
  ): Promise<{ enabled: boolean; grantedAt: string | null; revokedAt: string | null; granterUserId: string }>;
  listGitTokenAccessLog(projectId: string): Promise<GitTokenAccessLogEntry[]>;
  // Персональная пересортировка сайдбара: полный список id в желаемом порядке.
  reorder(orderedIds: readonly string[]): Promise<void>;

  // Персональная пометка проекта favorite (см. db/040). Сервер сам ставит
  // favorite_sort_order = MAX+1 при favorite=true.
  toggleFavorite(projectId: string, favorite: boolean): Promise<void>;

  // Пересортировка проектов внутри секции «Избранное» сайдбара. Симметрично reorder,
  // но затрагивает только favorite_sort_order для favorites текущего юзера.
  reorderFavorites(orderedIds: readonly string[]): Promise<void>;

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

  // Дедуплицированный список user'ов, с которыми caller состоит в общих проектах
  // (без caller'а самого). Используется UI-дропдауном «делегировать» во входящих.
  listSharedMembers(): Promise<SharedMember[]>;
}

export type SharedMember = {
  readonly id: string;
  readonly displayName: string;
  readonly email: string;
};
