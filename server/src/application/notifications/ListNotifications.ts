import type { ResolveActiveWorkspace } from '../workspace/activeWorkspace.js';
import type { Notification } from '../../domain/notifications/Notification.js';
import type { NotificationRepository } from './NotificationRepository.js';
import type { NotificationActionStates } from './NotificationActionStates.js';

type Deps = {
  readonly resolveActiveWorkspace: ResolveActiveWorkspace;
  readonly repo: NotificationRepository;
  readonly actionStates?: Pick<NotificationActionStates, 'reconcile' | 'attach'>;
};

export type ListNotificationsCommand = {
  readonly userId: string;
  readonly unreadOnly: boolean;
  readonly limit: number;
  // Только с действием (приглашения, запросы доступа) — раздел «Ждут ответа» у колокольчика.
  readonly actionableOnly?: boolean;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export class ListNotifications {
  constructor(private readonly deps: Deps) {}

  async execute(input: ListNotificationsCommand): Promise<Notification[]> {
    const workspace = await this.deps.resolveActiveWorkspace(input.userId);
    if (!workspace) return [];
    const limit = Math.max(1, Math.min(input.limit || DEFAULT_LIMIT, MAX_LIMIT));
    await this.deps.actionStates?.reconcile(input.userId, workspace.id);
    const list = await this.deps.repo.listByUser(input.userId, {
      limit,
      workspaceId: workspace.id,
      unreadOnly: input.unreadOnly,
      ...(input.actionableOnly ? { actionableOnly: true } : {}),
    });
    return this.deps.actionStates ? this.deps.actionStates.attach(list) : list;
  }
}
