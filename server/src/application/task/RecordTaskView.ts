import type { RecentTaskViewRepository } from './RecentTaskViewRepository.js';

type Deps = {
  readonly repo: RecentTaskViewRepository;
};

// Фиксирует факт открытия задачи юзером. Access-чек (членство в проекте) — в репозитории.
export class RecordTaskView {
  constructor(private readonly deps: Deps) {}

  execute(userId: string, taskId: string): Promise<void> {
    return this.deps.repo.recordView(userId, taskId);
  }
}
