import { requireProjectAccess, type ProjectAccessDeps } from '../project/projectAccess.js';
import type { TaskWorkerActivity } from '../../domain/live/TaskWorkerActivity.js';
import type { TaskWorkerActivityRepository } from './TaskWorkerActivityRepository.js';

type Deps = ProjectAccessDeps & {
  readonly activity: TaskWorkerActivityRepository;
  // Общий проект (db/182): какие из задач видны человеку. Без него — все.
  readonly visibleTaskIds?: (userId: string, taskIds: readonly string[]) => Promise<ReadonlySet<string>>;
};

export class GetProjectWorkerActivity {
  constructor(private readonly deps: Deps) {}
  async execute(projectId: string, userId: string): Promise<TaskWorkerActivity[]> {
    await requireProjectAccess(this.deps, projectId, userId, 'read_project');
    const list = await this.deps.activity.listByProject(projectId);
    if (list.length === 0 || !this.deps.visibleTaskIds) return list;
    const visible = await this.deps.visibleTaskIds(userId, list.map((item) => item.taskId));
    return list.filter((item) => visible.has(item.taskId));
  }
}
