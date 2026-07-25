import type { TaskStatus } from '../../domain/task/Task.js';

// Плоский результат глобального поиска: достаточно, чтобы отрисовать строку в палитре
// и перейти на доску проекта с подсветкой задачи. Полную задачу не тащим.
export type TaskSearchResult = {
  readonly taskId: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly status: TaskStatus;
  readonly excerpt: string;
  // Дата создания задачи — нужна сайдбар-поиску для сортировки по свежести.
  readonly createdAt: Date;
};

export type TaskSearchQuery = {
  readonly userId: string;
  readonly query: string;
  // true ⇒ искать по всем проектам (admin); false ⇒ только там, где userId — member.
  readonly includeAllProjects: boolean;
  // Изоляция по активному team-пространству: задан ⇒ ищем только в проектах этого
  // пространства. undefined ⇒ по всем пространствам юзера (дефолт-хаб / agent / admin).
  readonly workspaceId?: string;
  readonly limit: number;
};

export interface TaskSearchRepository {
  search(q: TaskSearchQuery): Promise<TaskSearchResult[]>;
}
