import type { ActivityFeedItem } from '../../domain/activity/ActivityFeedItem.js';
import type { Notification, NotificationPayload } from '../../domain/notifications/Notification.js';
import type { ActivityRepository } from './ActivityRepository.js';

// Уведомления, требующие действия (кнопки Принять/Отклонить). Только они формируют вкладку
// «Требуется действие» и считаются непрочитанными по умолчанию.
const ACTIONABLE_TYPES: ReadonlySet<string> = new Set([
  'project_invite',
  'join_request',
  'task_delegation',
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
  // id'шки проектов активного пространства — для скоупа уведомлений по пространству.
  readonly workspaceProjectIds: (workspaceId: string) => Promise<Set<string>>;
};

function payloadProjectId(p: NotificationPayload): string | null {
  return (p as { projectId?: string }).projectId ?? null;
}

// Уведомление относится к пространству, если его проект в наборе пространства, ИЛИ у него
// нет проекта (личные inbox-делегирования — показываем всегда, это персональные действия).
function inWorkspace(n: Notification, wsProjects: Set<string>): boolean {
  const pid = payloadProjectId(n.payload);
  return pid ? wsProjects.has(pid) : true;
}

function beforeOk(n: Notification, before?: Date): boolean {
  return !before || n.createdAt.getTime() < before.getTime();
}

export class GetActivityFeed {
  constructor(private readonly deps: Deps) {}

  async execute(
    userId: string,
    workspaceId: string,
    query: GetActivityFeedQuery,
  ): Promise<ActivityFeedItem[]> {
    const wsProjects = await this.deps.workspaceProjectIds(workspaceId);

    if (query.tab === 'action') {
      const notifs = await this.deps.notifications.listByUser(userId, {
        limit: query.limit,
        unreadOnly: true,
        before: query.before,
      });
      return notifs
        .filter(
          (n) =>
            ACTIONABLE_TYPES.has(n.payload.type) && inWorkspace(n, wsProjects) && beforeOk(n, query.before),
        )
        .slice(0, query.limit)
        .map((n) => ({ type: 'notification', createdAt: n.createdAt, notification: n }));
    }

    // tab === 'all': амбиентные события (workspace+membership-scoped в репозитории) +
    // уведомления (scoped по проектам пространства), слиты по времени.
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
      ...notifs
        .filter((n) => inWorkspace(n, wsProjects) && beforeOk(n, query.before))
        .map((notification) => ({
          type: 'notification' as const,
          createdAt: notification.createdAt,
          notification,
        })),
    ];
    items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return items.slice(0, query.limit);
  }
}
