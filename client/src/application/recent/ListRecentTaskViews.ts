import type { RecentTaskView } from '@/domain/recent/RecentTaskView';
import type { RecentTaskViewRepository } from './RecentTaskViewRepository';

export class ListRecentTaskViews {
  constructor(private readonly repo: RecentTaskViewRepository) {}

  execute(limit: number): Promise<RecentTaskView[]> {
    return this.repo.list(limit);
  }
}
