import type { Project, PublicAppearance } from '../../domain/project/Project.js';
import type { KanbanBoardSettings } from '../../domain/kanban/KanbanSettings.js';

export type CreateProjectInput = {
  readonly id: string;
  readonly ownerId: string;
  readonly name: string;
  // Пространство, которому принадлежит проект (обязательно — projects.workspace_id NOT NULL).
  readonly workspaceId: string;
  readonly isInbox?: boolean;
  // Слаг сайта-результата (db/100). Задаёт CreateProject; inbox не задаёт (сайта нет).
  readonly siteSlug?: string | null;
};

// Patch-семантика: undefined = поле не меняется, null = очистить, string = новое значение.
// На уровне domain поле string | null, а здесь добавляем undefined для отсутствия update'а.
export type UpdateProjectInput = {
  readonly name?: string;
  readonly icon?: string | null;
  readonly gitRepoUrl?: string | null;
  readonly kbRepoFullName?: string | null;
  readonly kbKind?: 'none' | 'github' | 'local';
  readonly financeVisibility?: 'owner' | 'members';
  readonly dispatcherUserId?: string | null;
  readonly multiTaskWorker?: boolean;
  readonly status?: 'active' | 'paused' | 'archived';
  // Notion-style шапка (db/091): описание + обложка (см. domain Project).
  readonly description?: string | null;
  readonly coverUrl?: string | null;
  readonly coverPosition?: number;
  // GitHub-репо приложения проекта (db/097). Ставится EnsureProjectAppRepo.
  readonly appRepoFullName?: string | null;
  readonly publicAppearance?: PublicAppearance;
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
  // Batch-версия findInboxByOwner: inbox-проекты сразу нескольких владельцев (одним
  // запросом). Нужна ленте «Личные · <Имя>» во входящих, где владельцев — весь круг
  // коллег caller'а. Владельцы без inbox'а просто отсутствуют в результате.
  listInboxesByOwners(ownerIds: readonly string[]): Promise<Project[]>;
  create(input: CreateProjectInput): Promise<Project>;
  // АТОМАРНО: создаёт проект + добавляет owner'а как member с role='owner'.
  // Без этой связки можно было получить orphan-проект (project существует, но в
  // project_members его нет → ни один use-case не пускает даже создателя). Использовать
  // вместо последовательного create() + members.add() в CreateProject / GetOrCreateInbox.
  createWithOwnerMembership(input: CreateProjectInput): Promise<Project>;
  // Без owner-фильтра: caller уже проверил доступ. Возвращает null если проект не найден.
  update(id: string, patch: UpdateProjectInput): Promise<Project | null>;

  // Публичная ссылка доски (Publish to web, db/096).
  // Lookup по public_slug для анонимного роута. null если такого slug нет.
  getBySlug(slug: string): Promise<Project | null>;
  // Lookup по site_slug (db/100) — для host-роутинга заглушки сайта. null если нет.
  findBySiteSlug(slug: string): Promise<Project | null>;
  // Опубликовать: проставить public_slug + is_public=1 + published_at (только если ещё NULL,
  // чтобы повторная публикация не сбрасывала дату первой). Возвращает 'slug_taken' если
  // slug занят другим проектом (UNIQUE-конфликт) — PublishProject перегенерирует и повторит.
  publish(id: string, slug: string): Promise<'ok' | 'slug_taken'>;
  // Снять с публикации: is_public=0. public_slug и published_at НЕ трогаем (повторный
  // Publish вернёт тот же URL).
  unpublish(id: string): Promise<void>;
  // Тоггл индексации поисковиками (public_indexing).
  setPublicIndexing(id: string, on: boolean): Promise<void>;
  // Перенос проекта в другое пространство (см. WorkspaceService.moveProject).
  setWorkspace(projectId: string, workspaceId: string): Promise<void>;
  // workspace_id проекта — для deep-link авто-switch активного пространства.
  getWorkspaceId(projectId: string): Promise<string | null>;
  // Проекты пространства (для страницы настроек пространства). Лёгкий read-model.
  listByWorkspace(workspaceId: string): Promise<Array<{ id: string; name: string; icon: string | null }>>;
  // Полный серверный read-model пространства, включая персональные inbox-проекты.
  // Нужен фоновым workspace-wide сценариям (например, напоминанию о дедлайнах),
  // где скрытие inbox из обычного UI-списка не должно скрывать сами задачи.
  listAllByWorkspace?(
    workspaceId: string,
  ): Promise<Array<{ id: string; name: string; icon: string | null }>>;
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

  // Общая (на весь проект) кастомизация канбан-доски. NULL в БД ⇒ null здесь ⇒ дефолты в UI.
  // setKanbanSettings полностью заменяет JSON-блоб (клиент шлёт уже смерженную карту).
  getKanbanSettings(projectId: string): Promise<KanbanBoardSettings | null>;
  setKanbanSettings(projectId: string, settings: KanbanBoardSettings): Promise<void>;
}
