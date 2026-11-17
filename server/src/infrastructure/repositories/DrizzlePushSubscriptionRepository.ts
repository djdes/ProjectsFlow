import { sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import type { PushSubscription } from '../../domain/push/PushSubscription.js';
import type { PushSubscriptionRepository } from '../../application/push/PushSubscriptionRepository.js';

type Row = {
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
};

function affectedRows(result: unknown): number {
  return (result as [{ affectedRows?: number }])[0]?.affectedRows ?? 0;
}

// Web Push device subscriptions (db/184).
export class DrizzlePushSubscriptionRepository implements PushSubscriptionRepository {
  constructor(private readonly db: Database) {}

  async upsert(subscription: PushSubscription): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
      VALUES (${subscription.userId}, ${subscription.endpoint}, ${subscription.keys.p256dh},
              ${subscription.keys.auth}, ${subscription.userAgent})
      ON DUPLICATE KEY UPDATE
        user_id = VALUES(user_id), p256dh = VALUES(p256dh), auth = VALUES(auth), user_agent = VALUES(user_agent),
        created_at = CURRENT_TIMESTAMP`);
  }

  async removeForUser(userId: string, endpoint: string): Promise<boolean> {
    const result = await this.db.execute(sql`
      DELETE FROM push_subscriptions WHERE user_id = ${userId} AND endpoint = ${endpoint}`);
    return affectedRows(result) > 0;
  }

  async remove(endpoint: string): Promise<void> {
    await this.db.execute(sql`DELETE FROM push_subscriptions WHERE endpoint = ${endpoint}`);
  }

  async listByUser(userId: string): Promise<PushSubscription[]> {
    const result = await this.db.execute(sql`
      SELECT user_id, endpoint, p256dh, auth, user_agent FROM push_subscriptions WHERE user_id = ${userId}`);
    return (result[0] as unknown as Row[]).map((row) => ({
      userId: String(row.user_id),
      endpoint: String(row.endpoint),
      keys: { p256dh: String(row.p256dh), auth: String(row.auth) },
      userAgent: row.user_agent === null ? null : String(row.user_agent),
    }));
  }

  async markSuccess(endpoint: string, at: Date): Promise<void> {
    await this.db.execute(sql`UPDATE push_subscriptions SET last_success_at = ${at} WHERE endpoint = ${endpoint}`);
  }

  async trimForUser(userId: string, keep: number): Promise<void> {
    const result = await this.db.execute(sql`
      SELECT id FROM push_subscriptions WHERE user_id = ${userId}
      ORDER BY GREATEST(created_at, COALESCE(last_success_at, created_at)) DESC, id DESC`);
    const extra = (result[0] as unknown as Array<{ id: number | string }>).slice(keep).map((row) => String(row.id));
    if (extra.length === 0) return;
    await this.db.execute(sql`
      DELETE FROM push_subscriptions WHERE user_id = ${userId}
        AND id IN (${sql.join(extra.map((id) => sql`${id}`), sql`, `)})`);
  }

  async removeAll(): Promise<number> {
    return affectedRows(await this.db.execute(sql`DELETE FROM push_subscriptions`));
  }
}
