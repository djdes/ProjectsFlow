import type { AgentJob } from '../agentJob/AgentJob';

// 'awaiting_clarification' — активная задача на паузе до действия человека (ответ на
// ralph-question, разбор после maxAttempts retry, переформулировка). Между in_progress
// и done — порядок в массиве определяет колонки канбана.
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
  readonly createdAt: Date;
  readonly updatedAt: Date;
  // Заполняются list-эндпоинтом. Для одиночных task-fetch'ей могут отсутствовать.
  readonly commitCount?: number;
  readonly attachmentCount?: number;
  readonly commentCount?: number;
  readonly delegatedToAgent: boolean;
  readonly agentJob: AgentJob | null;
};

// Короткий ID задачи (первые 8 hex-символов UUID без дефисов) — для вставки в commit
// message в формате `[xxxxxxxx]`. Server'ный SyncTaskCommits парсит этот pattern.
export function taskShortId(taskId: string): string {
  return taskId.replace(/-/g, '').slice(0, 8).toLowerCase();
}
