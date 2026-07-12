import type { TaskPriority, TaskStatus } from './Task';

// Шаблон задачи проекта (db/108, Notion Templates): заготовка для меню «Создать ▾».
// Mirrors server/src/domain/task/TaskTemplate.ts.
export type TaskTemplate = {
  readonly id: string;
  readonly projectId: string;
  // Имя шаблона в меню (не название будущей задачи).
  readonly name: string;
  readonly description: string;
  readonly status: TaskStatus;
  readonly priority: TaskPriority | null;
  readonly icon: string | null;
  readonly createdAt: Date;
};
