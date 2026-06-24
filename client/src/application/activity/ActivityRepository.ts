import type { FeedItem } from '@/domain/activity/ActivityFeedItem';

export type FeedTab = 'all' | 'action';

export type FeedPage = {
  readonly items: FeedItem[];
  // Курсор для подгрузки старее (ISO createdAt последнего элемента) или null если конец.
  readonly nextBefore: string | null;
};

export interface ActivityRepository {
  getFeed(
    workspaceId: string,
    opts: { tab: FeedTab; before?: string; limit?: number },
  ): Promise<FeedPage>;
}
