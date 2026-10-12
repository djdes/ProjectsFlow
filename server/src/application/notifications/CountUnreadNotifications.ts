import type { ResolveActiveWorkspace } from '../workspace/activeWorkspace.js';
import type { NotificationRepository } from './NotificationRepository.js';

type Deps = {
  readonly resolveActiveWorkspace: ResolveActiveWorkspace;
  readonly repo: NotificationRepository;
};

export class CountUnreadNotifications {
  constructor(private readonly deps: Deps) {}

  // actionableOnly — только уведомления с действием (для бейджа «Действие»),
  // иначе все непрочитанные.
  async execute(userId: string, actionableOnly = false): Promise<number> {
    const workspace = await this.deps.resolveActiveWorkspace(userId);
    if (!workspace) return 0;
    return actionableOnly
      ? this.deps.repo.countActionableUnread(userId, workspace.id)
      : this.deps.repo.countUnread(userId, workspace.id);
  }
}
