import { requireProjectAccess, type ProjectAccessDeps } from '../project/projectAccess.js';
import type { TaskWorkerActivity } from '../../domain/live/TaskWorkerActivity.js';
import type { TaskWorkerActivityRepository } from './TaskWorkerActivityRepository.js';

export class GetProjectWorkerActivity {
  constructor(private readonly deps: ProjectAccessDeps & { activity: TaskWorkerActivityRepository }) {}
  async execute(projectId: string, userId: string): Promise<TaskWorkerActivity[]> {
    await requireProjectAccess(this.deps, projectId, userId, 'read_project');
    return this.deps.activity.listByProject(projectId);
  }
}
