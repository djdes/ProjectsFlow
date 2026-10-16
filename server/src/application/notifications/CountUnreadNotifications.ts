import type { ResolveActiveWorkspace } from '../workspace/activeWorkspace.js';
import type { NotificationRepository } from './NotificationRepository.js';
import type { NotificationActionStates } from './NotificationActionStates.js';

type Deps = {
  readonly resolveActiveWorkspace: ResolveActiveWorkspace;
  readonly repo: NotificationRepository;
  readonly actionStates?: Pick<NotificationActionStates, 'reconcile'>;
};

export class CountUnreadNotifications {
  constructor(private readonly deps: Deps) {}

  // actionableOnly — только уведомления с действием (для бейджа «Действие»); since — бейдж
  // колокольчика (новые с прошлого просмотра + неотвеченные приглашения); иначе все непрочитанные.
  async execute(
    userId: string,
    opts: { actionableOnly?: boolean; since?: Date; mineOnly?: boolean } = {},
  ): Promise<number> {
    const workspace = await this.deps.resolveActiveWorkspace(userId);
    if (!workspace) return 0;
    // Бейджи считают приглашения без ответа — устаревшие гасим до подсчёта.
    await this.deps.actionStates?.reconcile(userId, workspace.id);
    return opts.actionableOnly
      ? this.deps.repo.countActionableUnread(userId, workspace.id)
      : this.deps.repo.countUnread(userId, workspace.id, {
          ...(opts.since ? { since: opts.since } : {}),
          ...(opts.mineOnly ? { mineOnly: true } : {}),
        });
  }
}
