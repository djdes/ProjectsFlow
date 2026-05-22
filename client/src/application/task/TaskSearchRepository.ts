import type { TaskSearchResult } from '@/domain/task/TaskSearchResult';

export interface TaskSearchRepository {
  search(query: string): Promise<TaskSearchResult[]>;
}
