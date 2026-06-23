import type { TaskStatus } from './Task.js';

// Недавно открытая задача (enriched-проекция для блока «Недавнее» в сайдбаре).
// taskExcerpt — короткая выжимка описания задачи (у задач нет отдельного title).
export type RecentTaskView = {
  readonly taskId: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly projectIcon: string | null;
  readonly projectIsInbox: boolean;
  readonly taskExcerpt: string;
  readonly status: TaskStatus;
  readonly viewedAt: Date;
};
