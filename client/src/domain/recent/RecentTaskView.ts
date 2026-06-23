import type { TaskStatus } from '@/domain/task/Task';

// Недавно открытая задача — проекция для блока «Недавнее» в сайдбаре. Зеркало серверного типа.
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
