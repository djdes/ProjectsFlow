import type { Project, ProjectStatus } from '@/domain/project/Project';
import type { ProjectAnalytics, ProjectActivity } from '@/domain/project/ProjectAnalytics';
import type { ProjectMember, ProjectRole } from '@/domain/project/ProjectMembership';
import type { NotificationPrefs } from '@/domain/notifications/NotificationPrefs';
import type { KanbanBoardSettings } from '@/domain/kanban/KanbanSettings';

// Сайт-результат проекта (db/100). siteSlug — постоянный адрес <slug>.projectsflow.ru (до
// деплоя воркером отдаётся заглушка). deployedAt/fileCount — из site_artifacts (null/0 до деплоя).
export type ProjectSite = {
  readonly siteSlug: string | null;
  readonly deployedAt: string | null;
  readonly fileCount: number;
};

// Бэкенд приложения проекта (SQLite-per-project, db/102). status='none' — бэкенд не заведён
// (обычный статический сайт). status='active' — есть вход/пользователи/база; usageBytes/лимит
// показываем в UI, tables — объявлённые воркером таблицы.
export type AppBackendStatus = {
  readonly status: 'none' | 'active';
  readonly usageBytes: number;
  readonly storageLimitBytes: number;
  readonly tables: readonly string[];
};

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
  // Эмодзи-иконка; null = сбросить на дефолтную папку.
  readonly icon?: string | null;
  readonly gitRepoUrl?: string | null;
  readonly kbRepoFullName?: string | null;
  // Статус: 'archived' прячет проект в секцию «Архивные», 'active' возвращает.
  readonly status?: ProjectStatus;
  // Notion-style шапка: описание, обложка (`gradient:<id>` или URL картинки; null = убрать),
  // позиция обложки по вертикали в % (0–100).
  readonly description?: string | null;
  readonly coverUrl?: string | null;
  readonly coverPosition?: number;
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
  // Загрузка своего файла-обложки (multipart). Сервер сохраняет и возвращает проект с
  // проставленным coverUrl (`/api/projects/:id/cover/...`). Градиент/ссылку ставим через update.
  // onProgress — прогресс аплоада 0..100 (для мгновенного прогресс-бара в UI).
  uploadCover(projectId: string, file: File, onProgress?: (pct: number) => void): Promise<Project>;
  // Безвозвратное удаление проекта (owner-only, инбокс запрещён). Каскадно чистит
  // все child-данные (задачи, KB, секреты, финансы и т.д.) — подробности
  // на серверном DeleteProject use-case.
  delete(id: string): Promise<void>;
  // Ralph-диспетчер проекта: кто автономно выполняет задачи через MCP /loop.
  // listDispatcherCandidates — кого МОЖНО назначить (участники с ≥1 активным
  // agent-токеном); setDispatcher — назначить/снять (owner-only).
  listDispatcherCandidates(projectId: string): Promise<DispatcherCandidate[]>;
  setDispatcher(projectId: string, userId: string | null): Promise<Project>;
  // Мультизадачный воркер проекта: вкл/выкл параллельное выполнение задач диспетчером.
  // Любой участник проекта (viewer+). Сервер вернёт обновлённый проект.
  setMultiTaskWorker(projectId: string, enabled: boolean): Promise<Project>;
  // Публичная ссылка доски (Publish to web, db/096). Owner-only. publish → возвращает
  // slug + полный url; unpublish снимает; setPublicIndexing тогглит индексацию поисковиками.
  publish(projectId: string): Promise<{ slug: string; url: string }>;
  unpublish(projectId: string): Promise<void>;
  setPublicIndexing(projectId: string, indexing: boolean): Promise<void>;
  // Создать/привязать GitHub-репо приложения проекта (self-serve воркер-раннер, M1). Owner-only.
  // Требует привязанный GitHub (иначе сервер вернёт 409 github_not_connected).
  ensureAppRepo(projectId: string): Promise<{ appRepoFullName: string }>;
  // Создать НОВЫЙ GitHub-репо под аккаунтом текущего юзера и подключить как gitRepoUrl.
  // Editor+. Ошибки: 409 repo_already_connected|github_not_connected, 422 github_repo_name_taken.
  createRepo(
    projectId: string,
    input: { name: string; privateRepo: boolean },
  ): Promise<{ fullName: string; gitRepoUrl: string }>;
  // Сайт-результат проекта (db/100): siteSlug есть всегда (адрес <slug>.projectsflow.ru; до
  // деплоя — заглушка), deployedAt/fileCount из site_artifacts (null/0, пока не задеплоен).
  getProjectSite(projectId: string): Promise<ProjectSite>;
  // Статус бэкенда приложения (db/102): включён ли, usage/лимит, таблицы. Member-доступ (read).
  getAppBackendStatus(projectId: string): Promise<AppBackendStatus>;
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

  // Multi-tenancy: members (read-only с клиента — управление ролью/составом/владением
  // переехало на уровень пространства, см. workspaceRepository).
  listMembers(projectId: string): Promise<ProjectMember[]>;

  // Git-collision → join-request: проверка совпадения репо + заявка на вступление +
  // её разрешение владельцем (accept/decline).
  checkGitCollision(gitRepoUrl: string): Promise<GitCollision>;
  requestJoin(projectId: string): Promise<void>;
  resolveJoinRequest(requestId: string, accept: boolean): Promise<void>;

  // Пер-участниковые настройки email-оповещений (свои, по проекту).
  getNotificationPrefs(projectId: string): Promise<NotificationPrefs>;
  setNotificationPrefs(projectId: string, prefs: NotificationPrefs): Promise<NotificationPrefs>;

  // Общая (на весь проект) кастомизация канбан-доски: цвета/переименования/скрытие колонок.
  // Write — editor+ (сервер вернёт 403 для viewer). {} = дефолты.
  getKanbanSettings(projectId: string): Promise<KanbanBoardSettings>;
  setKanbanSettings(projectId: string, settings: KanbanBoardSettings): Promise<KanbanBoardSettings>;

  // Дедуплицированный список user'ов, с которыми caller состоит в общих проектах
  // (без caller'а самого). Используется UI-выбором ответственного во входящих.
  listSharedMembers(): Promise<SharedMember[]>;

  // Аналитика/активность проекта (окно активности проекта в шапке).
  // recordProjectView — fire-and-forget при открытии проекта (сервер троттлит).
  recordProjectView(projectId: string): Promise<void>;
  getProjectAnalytics(projectId: string, days: number): Promise<ProjectAnalytics>;
  getProjectActivity(projectId: string, limit: number): Promise<ProjectActivity>;
}

export type SharedMember = {
  readonly id: string;
  readonly displayName: string;
  readonly email: string;
  readonly avatarUrl: string | null;
};
