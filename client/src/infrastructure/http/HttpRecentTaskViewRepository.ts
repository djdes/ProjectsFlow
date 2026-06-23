import type { TaskStatus } from '@/domain/task/Task';
import type { RecentTaskView } from '@/domain/recent/RecentTaskView';
import type { RecentTaskViewRepository } from '@/application/recent/RecentTaskViewRepository';
import { httpClient } from './httpClient';

type RecentTaskViewDto = {
  taskId: string;
  projectId: string;
  projectName: string;
  projectIcon: string | null;
  projectIsInbox: boolean;
  taskExcerpt: string;
  status: TaskStatus;
  viewedAt: string;
};

function fromDto(dto: RecentTaskViewDto): RecentTaskView {
  return {
    taskId: dto.taskId,
    projectId: dto.projectId,
    projectName: dto.projectName,
    projectIcon: dto.projectIcon ?? null,
    projectIsInbox: dto.projectIsInbox,
    taskExcerpt: dto.taskExcerpt,
    status: dto.status,
    viewedAt: new Date(dto.viewedAt),
  };
}

export class HttpRecentTaskViewRepository implements RecentTaskViewRepository {
  async record(taskId: string): Promise<void> {
    await httpClient.post<void>('/recent-task-views', { taskId });
  }

  async list(limit: number): Promise<RecentTaskView[]> {
    const res = await httpClient.get<{ recent: RecentTaskViewDto[] }>(
      `/recent-task-views?limit=${limit}`,
    );
    return res.recent.map(fromDto);
  }
}
