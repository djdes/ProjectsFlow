import type { TaskStatus } from './Task';

// Результат глобального поиска по задачам. Плоский DTO для палитры поиска:
// строка-результат + переход на доску проекта.
export type TaskSearchResult = {
  readonly taskId: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly status: TaskStatus;
  readonly excerpt: string;
  // ISO-дата создания задачи (для сортировки результатов сайдбар-поиска по свежести).
  readonly createdAt: string;
};
