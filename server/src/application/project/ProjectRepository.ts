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

export interface ProjectRepository {
  // Все методы scoped по ownerId — пользователь не видит чужих данных.
  listByOwner(ownerId: string): Promise<Project[]>;
  getByIdForOwner(id: string, ownerId: string): Promise<Project | null>;
  // Возвращает inbox-проект юзера если он есть. Не создаёт — для создания см. GetOrCreateInbox.
  findInboxByOwner(ownerId: string): Promise<Project | null>;
  create(input: CreateProjectInput): Promise<Project>;
  // Возвращает null если проект не найден / не принадлежит owner'у.
  update(id: string, ownerId: string, patch: UpdateProjectInput): Promise<Project | null>;
}
