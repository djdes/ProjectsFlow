import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { users } from '../db/schema.js';
import type { UserActivityRepository } from '../../application/user/UserActivityRepository.js';

// updated_at stays as it is: activity marks are not profile changes.
export class DrizzleUserActivityRepository implements UserActivityRepository {
  constructor(private readonly db: Database) {}

  async recordLogin(userId: string, at: Date): Promise<void> {
    await this.db.update(users)
      .set({ lastLoginAt: at, lastSeenAt: at, updatedAt: sql`${users.updatedAt}` })
      .where(eq(users.id, userId));
  }

  async touchLastSeen(userId: string, at: Date, olderThan: Date): Promise<void> {
    await this.db.update(users)
      .set({ lastSeenAt: at, updatedAt: sql`${users.updatedAt}` })
      .where(and(eq(users.id, userId), or(isNull(users.lastSeenAt), lt(users.lastSeenAt, olderThan))));
  }
}
