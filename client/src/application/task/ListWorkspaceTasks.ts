import type { TaskAssigneeRepository } from './TaskAssigneeRepository';
import { groupWorkspaceTasks, type WorkspaceTaskGroup } from '@/domain/task/WorkspaceTasks';

export type WorkspaceTasksResult = {
  readonly workspaceId: string;
} & ({ readonly status: 'ready'; readonly groups: readonly WorkspaceTaskGroup[] }
  | { readonly status: 'error' });

export class ListWorkspaceTasks {
  constructor(private readonly tasks: Pick<TaskAssigneeRepository, 'listMineInWorkspace' | 'listOthersInWorkspace'>) {}

  async execute(workspaceIds: readonly string[]): Promise<WorkspaceTasksResult[]> {
    return Promise.all([...new Set(workspaceIds)].map(async (workspaceId): Promise<WorkspaceTasksResult> => {
      try {
        const [mine, others] = await Promise.all([
          this.tasks.listMineInWorkspace(workspaceId),
          this.tasks.listOthersInWorkspace(workspaceId),
        ]);
        return { workspaceId, status: 'ready', groups: groupWorkspaceTasks([...mine, ...others]) };
      } catch {
        // A failed workspace remains explicit; never present a partial result as all tasks.
        return { workspaceId, status: 'error' };
      }
    }));
  }
}
