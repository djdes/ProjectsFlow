import type { Project } from '../../domain/project/Project.js';

export type CreateProjectInput = {
  readonly id: string;
  readonly ownerId: string;
  readonly name: string;
  readonly isInbox?: boolean;
};

// Patch-семантика: undefined = поле не меняется, null = очистить, string = новое значение.
// На уровне domain поле string | null, а здесь добавляем undefined для отсутствия update'а.
export type UpdateProjectInput = {
  readonly name?: string;
  readonly gitRepoUrl?: string | null;
  readonly kbRepoFullName?: string | null;
  readonly kbKind?: 'none' | 'github' | 'local';
  readonly financeVisibility?: 'owner' | 'members';
  readonly dispatcherUserId?: string | null;
};

// Multi-tenancy: проверка доступа НЕ внутри ProjectRepository — она в use-case'ах через
// requireProjectAccess() (см. projectAccess.ts), которая лукапит membership + role.
// Здесь только «сырая» БД.
export interface ProjectRepository {
  // Сырой look-up без access-check'а. Use-case вызывает после requireProjectAccess.
  getById(id: string): Promise<Project | null>;
  // Возвращает inbox-проект юзера если он есть. Не создаёт — для создания см. GetOrCreateInbox.
  // Остаётся per-owner потому что inbox personal: 1 user = 1 inbox (см. spec секцию 7, решение 3).
  findInboxByOwner(ownerId: string): Promise<Project | null>;
  create(input: CreateProjectInput): Promise<Project>;
  // Без owner-фильтра: caller уже проверил доступ. Возвращает null если проект не найден.
  update(id: string, patch: UpdateProjectInput): Promise<Project | null>;
  // Все проекты с непустым git_repo_url. Нормализацию/фильтрацию делает use-case
  // (CheckGitCollision) — он же контролирует cross-tenant-раскрытие.
  listWithGitRepo(): Promise<Project[]>;
  // Полное каскадное удаление проекта в ОДНОЙ транзакции: все child-таблицы
  // (tasks/comments/commits/attachment-rows/kb_documents/secrets/finance/invites/
  // join_requests/members/agent_jobs) + сам project. Файлы аттачей с диска чистит
  // use-case ДО вызова этого метода (отдельный fire-and-forget storage.delete).
  // Не удаляет: GitHub-репо проекта (внешний ресурс), employees (owner-scoped,
  // шарятся между проектами), notifications (user-scoped, soft-fallback при клике).
  deleteCascade(projectId: string): Promise<void>;
  // Все проекты, где dispatcher_user_id = userId. Используется агентом
  // (`pf_list_my_dispatched_projects`) для понимания «какие проекты сейчас на мне».
  listDispatchedByUser(userId: string): Promise<Project[]>;
  // Снять userId со всех его проектов-диспетчеров. Вызывается из RevokeAgentToken
  // когда у юзера revoked последний активный токен — он перестал быть ralph-capable,
  // нельзя оставлять его диспетчером.
  clearDispatcherForUser(userId: string): Promise<number>;
}
