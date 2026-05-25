// 'awaiting_clarification' — активная работа на паузе до действия человека
// (ответ на ralph-question, разбор после maxAttempts retry, переформулировка задачи,
// auto-timeout F11). В пайплайне сидит между in_progress и done, поэтому в массиве
// тоже между ними — порядок определяет колонки канбана и фильтры.
export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'awaiting_clarification' | 'done';

export const TASK_STATUSES: readonly TaskStatus[] = [
  'backlog',
  'todo',
  'in_progress',
  'awaiting_clarification',
  'done',
];

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
