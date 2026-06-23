import type { RecentTaskViewRepository } from './RecentTaskViewRepository';

export class RecordTaskView {
  constructor(private readonly repo: RecentTaskViewRepository) {}

  execute(taskId: string): Promise<void> {
    return this.repo.record(taskId);
  }
}
