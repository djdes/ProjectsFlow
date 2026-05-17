import type { Task, TaskStatus } from '@/domain/task/Task';
import type { TaskCommit } from '@/domain/task/TaskCommit';

export type CreateTaskInput = {
  readonly title: string;
  readonly description: string | null;
  readonly status?: TaskStatus;
};

export type UpdateTaskInput = {
  readonly title?: string;
  readonly description?: string | null;
};

export type MoveTaskInput = {
  readonly targetStatus: TaskStatus;
  readonly beforeTaskId: string | null;
  readonly afterTaskId: string | null;
};

export type SyncCommitsResult = {
  readonly linkedCount: number;
  readonly autoTransitionedCount: number;
  readonly scannedCount: number;
};

export interface TaskRepository {
  list(projectId: string): Promise<Task[]>;
  create(projectId: string, input: CreateTaskInput): Promise<Task>;
  update(projectId: string, taskId: string, input: UpdateTaskInput): Promise<Task>;
  move(projectId: string, taskId: string, input: MoveTaskInput): Promise<Task>;
  delete(projectId: string, taskId: string): Promise<void>;
  listCommits(projectId: string, taskId: string): Promise<TaskCommit[]>;
  linkCommit(projectId: string, taskId: string, sha: string): Promise<TaskCommit>;
  unlinkCommit(projectId: string, taskId: string, sha: string): Promise<void>;
  syncCommits(projectId: string): Promise<SyncCommitsResult>;
}
