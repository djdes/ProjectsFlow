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
  // Заполняется list-эндпоинтом (LEFT JOIN на task_commits). Для одиночных task-fetch'ей
  // может отсутствовать — рассчитывается на 0.
  readonly commitCount?: number;
};

// Короткий ID задачи (первые 8 hex-символов UUID без дефисов) — для вставки в commit
// message в формате `[xxxxxxxx]`. Server'ный SyncTaskCommits парсит этот pattern.
export function taskShortId(taskId: string): string {
  return taskId.replace(/-/g, '').slice(0, 8).toLowerCase();
}
