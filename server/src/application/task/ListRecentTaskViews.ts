import type { RecentTaskView } from '../../domain/task/RecentTaskView.js';
import type { RecentTaskViewRepository } from './RecentTaskViewRepository.js';

type Deps = {
  readonly repo: RecentTaskViewRepository;
};

const DEFAULT_LIMIT = 3;
const MAX_LIMIT = 50;

export class ListRecentTaskViews {
  constructor(private readonly deps: Deps) {}

  execute(userId: string, limit?: number): Promise<RecentTaskView[]> {
    const clamped = Math.max(1, Math.min(limit || DEFAULT_LIMIT, MAX_LIMIT));
    return this.deps.repo.listRecent(userId, clamped);
  }
}
