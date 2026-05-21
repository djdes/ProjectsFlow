export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'done';

export const TASK_STATUSES: readonly TaskStatus[] = ['backlog', 'todo', 'in_progress', 'done'];

export type Task = {
  readonly id: string;
  readonly projectId: string;
  readonly description: string | null;
  readonly status: TaskStatus;
  readonly position: number;
  readonly delegatedToAgent: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};
