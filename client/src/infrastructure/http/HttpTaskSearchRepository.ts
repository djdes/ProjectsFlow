import type { TaskStatus } from '@/domain/task/Task';
import type { TaskSearchResult } from '@/domain/task/TaskSearchResult';
import type { TaskSearchRepository } from '@/application/task/TaskSearchRepository';
import { httpClient } from './httpClient';

type TaskSearchResultDto = {
  taskId: string;
  projectId: string;
  projectName: string;
  status: TaskStatus;
  excerpt: string;
  createdAt: string;
};

export class HttpTaskSearchRepository implements TaskSearchRepository {
  async search(query: string): Promise<TaskSearchResult[]> {
    const { results } = await httpClient.get<{ results: TaskSearchResultDto[] }>(
      `/search/tasks?q=${encodeURIComponent(query)}`,
    );
    return results;
  }
}
