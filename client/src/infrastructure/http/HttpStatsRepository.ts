import type {
  StatsRepository,
  WorkspaceCompletedStats,
} from '@/application/stats/StatsRepository';
import { httpClient } from './httpClient';

export class HttpStatsRepository implements StatsRepository {
  constructor(private readonly client: typeof httpClient = httpClient) {}

  async completedToday(since: Date): Promise<number> {
    const { count } = await this.client.get<{ count: number }>(
      `/me/stats/completed-today?since=${encodeURIComponent(since.toISOString())}`,
    );
    return count;
  }

  async completedByWorkspace(): Promise<WorkspaceCompletedStats[]> {
    const { workspaces } = await this.client.get<{ workspaces: WorkspaceCompletedStats[] }>(
      '/me/stats/completed-by-workspace',
    );
    return workspaces;
  }

  async unreadTaskIds(): Promise<string[]> {
    const { taskIds } = await this.client.get<{ taskIds: string[] }>('/me/unread-tasks');
    return taskIds;
  }
}
