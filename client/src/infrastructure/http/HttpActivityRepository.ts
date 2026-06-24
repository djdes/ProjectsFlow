import type { Notification, NotificationPayload } from '@/domain/notifications/Notification';
import type {
  ActivityEventItem,
  ActivityKind,
  ActivityPayload,
  FeedItem,
} from '@/domain/activity/ActivityFeedItem';
import type {
  ActivityRepository,
  FeedPage,
  FeedTab,
} from '@/application/activity/ActivityRepository';
import { httpClient } from './httpClient';

type ActivityDto = {
  type: 'activity';
  createdAt: string;
  id: string;
  kind: string;
  projectId: string;
  actorUserId: string | null;
  actorDisplayName: string | null;
  actorAvatarUrl: string | null;
  targetDisplayName: string | null;
  payload: ActivityPayload | null;
};

type NotificationDto = {
  id: string;
  userId: string;
  payload: NotificationPayload;
  readAt: string | null;
  createdAt: string;
};

type NotificationFeedDto = { type: 'notification'; createdAt: string; notification: NotificationDto };
type FeedItemDto = ActivityDto | NotificationFeedDto;

// Защита от double-serialized JSON (MariaDB LONGTEXT → строка), как в HttpNotificationRepository.
function parseNotification(dto: NotificationDto): Notification {
  const payload: NotificationPayload =
    typeof dto.payload === 'string'
      ? (JSON.parse(dto.payload) as NotificationPayload)
      : dto.payload;
  return {
    id: dto.id,
    userId: dto.userId,
    payload,
    readAt: dto.readAt ? new Date(dto.readAt) : null,
    createdAt: new Date(dto.createdAt),
  };
}

function fromDto(dto: FeedItemDto): FeedItem {
  if (dto.type === 'notification') {
    return { type: 'notification', createdAt: new Date(dto.createdAt), notification: parseNotification(dto.notification) };
  }
  const item: ActivityEventItem = {
    type: 'activity',
    createdAt: new Date(dto.createdAt),
    id: dto.id,
    kind: dto.kind as ActivityKind,
    projectId: dto.projectId,
    actorUserId: dto.actorUserId,
    actorDisplayName: dto.actorDisplayName,
    actorAvatarUrl: dto.actorAvatarUrl,
    targetDisplayName: dto.targetDisplayName,
    payload: dto.payload,
  };
  return item;
}

export class HttpActivityRepository implements ActivityRepository {
  async getFeed(
    workspaceId: string,
    opts: { tab: FeedTab; before?: string; limit?: number },
  ): Promise<FeedPage> {
    const params = new URLSearchParams();
    params.set('tab', opts.tab);
    if (opts.before) params.set('before', opts.before);
    if (opts.limit) params.set('limit', String(opts.limit));
    const { items, nextBefore } = await httpClient.get<{ items: FeedItemDto[]; nextBefore: string | null }>(
      `/workspaces/${workspaceId}/feed?${params.toString()}`,
    );
    return { items: items.map(fromDto), nextBefore };
  }
}
