import type { TaskSearchResult } from '@/domain/task/TaskSearchResult';
import type { TaskSearchRepository } from './TaskSearchRepository';

export class SearchTasks {
  constructor(private readonly repo: TaskSearchRepository) {}

  execute(query: string): Promise<TaskSearchResult[]> {
    return this.repo.search(query);
  }
}
