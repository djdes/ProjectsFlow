import type { ResolveActiveWorkspace } from '../workspace/activeWorkspace.js';
import type { NotificationRepository } from './NotificationRepository.js';

type Deps = {
  readonly resolveActiveWorkspace: ResolveActiveWorkspace;
  readonly repo: NotificationRepository;
  readonly now: () => Date;
};

export class MarkAllNotificationsRead {
  constructor(private readonly deps: Deps) {}

  async execute(userId: string): Promise<number> {
    const workspace = await this.deps.resolveActiveWorkspace(userId);
    if (!workspace) return 0;
    return this.deps.repo.markAllRead(userId, this.deps.now(), workspace.id);
  }
}
