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
}
