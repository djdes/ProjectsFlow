export type TaskStatus = 'todo' | 'in_progress' | 'done';

export const TASK_STATUSES: readonly TaskStatus[] = ['todo', 'in_progress', 'done'];

export type Task = {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly description: string | null;
  readonly status: TaskStatus;
  readonly position: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};
