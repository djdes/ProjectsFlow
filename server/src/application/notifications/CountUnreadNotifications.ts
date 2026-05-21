import type { NotificationRepository } from './NotificationRepository.js';

type Deps = {
  readonly repo: NotificationRepository;
};

export class CountUnreadNotifications {
  constructor(private readonly deps: Deps) {}

  execute(userId: string): Promise<number> {
    return this.deps.repo.countUnread(userId);
  }
}
