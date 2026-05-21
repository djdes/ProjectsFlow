import type { NotificationRepository } from './NotificationRepository.js';

type Deps = {
  readonly repo: NotificationRepository;
  readonly now: () => Date;
};

export class MarkAllNotificationsRead {
  constructor(private readonly deps: Deps) {}

  execute(userId: string): Promise<number> {
    return this.deps.repo.markAllRead(userId, this.deps.now());
  }
}
