import type { StatsRepository } from '@/application/stats/StatsRepository';
import { httpClient } from './httpClient';

export class HttpStatsRepository implements StatsRepository {
  async completedToday(since: Date): Promise<number> {
    const { count } = await httpClient.get<{ count: number }>(
      `/me/stats/completed-today?since=${encodeURIComponent(since.toISOString())}`,
    );
    return count;
  }
}
