import type {
  StatsRepository,
  WorkspaceCompletedStats,
} from '@/application/stats/StatsRepository';
import { httpClient } from './httpClient';

export class HttpStatsRepository implements StatsRepository {
  async completedToday(since: Date): Promise<number> {
    const { count } = await httpClient.get<{ count: number }>(
      `/me/stats/completed-today?since=${encodeURIComponent(since.toISOString())}`,
    );
    return count;
  }

  async completedByWorkspace(): Promise<WorkspaceCompletedStats[]> {
    const { workspaces } = await httpClient.get<{ workspaces: WorkspaceCompletedStats[] }>(
      '/me/stats/completed-by-workspace',
    );
    return workspaces;
  }

  async unreadTaskIds(): Promise<string[]> {
    const { taskIds } = await httpClient.get<{ taskIds: string[] }>('/me/unread-tasks');
    return taskIds;
  }
}
