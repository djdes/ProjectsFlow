import type { ActivityFeedItem } from '../../domain/activity/ActivityFeedItem.js';
import { ACTIONABLE_NOTIFICATION_TYPES, type Notification } from '../../domain/notifications/Notification.js';
import type { ActivityRepository } from './ActivityRepository.js';
import type { NotificationActionStates } from '../notifications/NotificationActionStates.js';

// Уведомления, требующие действия (кнопка «Принять»). Только они формируют вкладку
// «Требуется действие».
const ACTIONABLE_TYPES: ReadonlySet<string> = new Set(ACTIONABLE_NOTIFICATION_TYPES);

export type FeedTab = 'all' | 'action';
export type GetActivityFeedQuery = {
  readonly tab: FeedTab;
  readonly before?: Date;
  readonly limit: number;
};

type NotificationsPort = {
  listByUser(
    userId: string,
    opts: { limit: number; unreadOnly: boolean; before?: Date; workspaceId?: string; actionableOnly?: boolean },
  ): Promise<Notification[]>;
};

type Deps = {
  readonly activity: ActivityRepository;
  readonly notifications: NotificationsPort;
  readonly actionStates?: Pick<NotificationActionStates, 'reconcile' | 'attach'>;
};

export class GetActivityFeed {
  constructor(private readonly deps: Deps) {}

  async execute(
    userId: string,
    workspaceId: string,
    query: GetActivityFeedQuery,
  ): Promise<ActivityFeedItem[]> {
    await this.deps.actionStates?.reconcile(userId, workspaceId);
    const attach = (list: Notification[]): Promise<Notification[]> =>
      this.deps.actionStates ? this.deps.actionStates.attach(list) : Promise.resolve(list);
    if (query.tab === 'action') {
      const notifs = await this.deps.notifications.listByUser(userId, {
        limit: query.limit,
        unreadOnly: true,
        workspaceId,
        actionableOnly: true,
        before: query.before,
      });
      return (await attach(notifs))
        .filter((n) => ACTIONABLE_TYPES.has(n.payload.type))
        .slice(0, query.limit)
        .map((n) => ({ type: 'notification', createdAt: n.createdAt, notification: n }));
    }

    // tab === 'all': амбиентные события (workspace+membership-scoped в репозитории) +
    // уведомления юзера в этом пространстве плюс личные (приглашения, см. isVisibleInWorkspace),
    // слиты по времени.
    const [events, notifs] = await Promise.all([
      this.deps.activity.listForUserInWorkspace(userId, workspaceId, {
        before: query.before,
        limit: query.limit,
      }),
      this.deps.notifications.listByUser(userId, {
        limit: query.limit,
        unreadOnly: false,
        workspaceId,
        before: query.before,
      }),
    ]);

    const items: ActivityFeedItem[] = [
      ...events.map((event) => ({ type: 'activity' as const, createdAt: event.createdAt, event })),
      ...(await attach(notifs)).map((notification) => ({
        type: 'notification' as const,
        createdAt: notification.createdAt,
        notification,
      })),
    ];
    items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return items.slice(0, query.limit);
  }
}
