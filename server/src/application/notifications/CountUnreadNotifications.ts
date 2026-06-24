import type { NotificationRepository } from './NotificationRepository.js';

type Deps = {
  readonly repo: NotificationRepository;
};

export class CountUnreadNotifications {
  constructor(private readonly deps: Deps) {}

  // actionableOnly — только уведомления с действием (для бейджа «Действие»),
  // иначе все непрочитанные.
  execute(userId: string, actionableOnly = false): Promise<number> {
    return actionableOnly
      ? this.deps.repo.countActionableUnread(userId)
      : this.deps.repo.countUnread(userId);
  }
}
