import type { ActivityRepository, FeedPage, FeedTab } from './ActivityRepository';

export class GetActivityFeed {
  constructor(private readonly repo: ActivityRepository) {}

  execute(
    workspaceId: string,
    opts: { tab: FeedTab; before?: string; limit?: number },
  ): Promise<FeedPage> {
    return this.repo.getFeed(workspaceId, opts);
  }
}
