import type { TaskWorkerActivity } from '../../domain/live/TaskWorkerActivity.js';

export interface TaskWorkerActivityRepository {
  listByProject(projectId: string): Promise<TaskWorkerActivity[]>;
}
