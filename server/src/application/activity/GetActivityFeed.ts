import type { ActivityFeedItem } from '../../domain/activity/ActivityFeedItem.js';
import type { Notification } from '../../domain/notifications/Notification.js';
import type { ActivityRepository } from './ActivityRepository.js';

// Уведомления, требующие действия (кнопка «Принять»). Только они формируют вкладку
// «Требуется действие». task_delegation сюда НЕ входит: делегирование принимается
// автоматически (спека §4), уведомление о нём — информационное.
// Зеркало: DrizzleNotificationRepository.countActionableUnread — менять СИНХРОННО.
const ACTIONABLE_TYPES: ReadonlySet<string> = new Set([
  'workspace_invite',
  'project_invite',
  'join_request',
]);

export type FeedTab = 'all' | 'action';
export type GetActivityFeedQuery = {
  readonly tab: FeedTab;
  readonly before?: Date;
  readonly limit: number;
};

type NotificationsPort = {
  listByUser(
    userId: string,
    opts: { limit: number; unreadOnly: boolean; before?: Date },
  ): Promise<Notification[]>;
};

type Deps = {
  readonly activity: ActivityRepository;
  readonly notifications: NotificationsPort;
};

export class GetActivityFeed {
  constructor(private readonly deps: Deps) {}

  async execute(
    userId: string,
    workspaceId: string,
    query: GetActivityFeedQuery,
  ): Promise<ActivityFeedItem[]> {
    if (query.tab === 'action') {
      const notifs = await this.deps.notifications.listByUser(userId, {
        limit: query.limit,
        unreadOnly: true,
        before: query.before,
      });
      return notifs
        .filter((n) => ACTIONABLE_TYPES.has(n.payload.type))
        .slice(0, query.limit)
        .map((n) => ({ type: 'notification', createdAt: n.createdAt, notification: n }));
    }

    // tab === 'all': амбиентные события (workspace+membership-scoped в репозитории) +
    // ВСЕ уведомления юзера (персональные, БЕЗ скоупа по пространству — колокольчика больше
    // нет, лента «Все» это единственная поверхность уведомлений), слиты по времени.
    const [events, notifs] = await Promise.all([
      this.deps.activity.listForUserInWorkspace(userId, workspaceId, {
        before: query.before,
        limit: query.limit,
      }),
      this.deps.notifications.listByUser(userId, {
        limit: query.limit,
        unreadOnly: false,
        before: query.before,
      }),
    ]);

    const items: ActivityFeedItem[] = [
      ...events.map((event) => ({ type: 'activity' as const, createdAt: event.createdAt, event })),
      ...notifs.map((notification) => ({
        type: 'notification' as const,
        createdAt: notification.createdAt,
        notification,
      })),
    ];
    items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return items.slice(0, query.limit);
  }
}
