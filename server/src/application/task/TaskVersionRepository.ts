import type { TaskSnapshot, TaskVersion } from '../../domain/task/TaskVersion.js';

export type CreateTaskVersionInput = {
  readonly id: string;
  readonly taskId: string;
  readonly projectId: string;
  readonly actorUserId: string | null;
  readonly snapshot: TaskSnapshot;
};

export interface TaskVersionRepository {
  create(input: CreateTaskVersionInput): Promise<void>;
  /** Версии задачи, новые → старые. */
  listForTask(taskId: string): Promise<TaskVersion[]>;
  getById(id: string): Promise<TaskVersion | null>;
  /** Из переданных taskId — те, у которых есть хотя бы одна версия (для гейта кнопки истории). */
  taskIdsWithVersions(taskIds: readonly string[]): Promise<Set<string>>;
}
