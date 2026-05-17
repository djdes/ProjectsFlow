import type { TaskCommit } from '../../domain/task/TaskCommit.js';

export type LinkCommitInput = {
  readonly taskId: string;
  readonly sha: string;
  readonly message: string;
  readonly authorName: string;
  readonly authorAvatarUrl: string | null;
  readonly htmlUrl: string;
  readonly committedAt: Date;
};

export interface TaskCommitRepository {
  listByTask(taskId: string): Promise<TaskCommit[]>;
  // Список (taskId, sha) для группы задач — для построения counts/preview на kanban-доске одним запросом.
  listByTasks(taskIds: readonly string[]): Promise<TaskCommit[]>;
  // Map taskId → количество коммитов. Используется ListTasks для enriched DTO.
  countsByTasks(taskIds: readonly string[]): Promise<ReadonlyMap<string, number>>;
  // Upsert: повторная привязка того же sha к той же задаче — no-op.
  link(input: LinkCommitInput): Promise<{ linked: boolean }>;
  unlink(taskId: string, sha: string): Promise<boolean>;
  countByTask(taskId: string): Promise<number>;
}
