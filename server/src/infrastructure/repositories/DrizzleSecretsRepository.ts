import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Database } from '../db/index.js';
import { secrets, type SecretRow } from '../db/schema.js';
import type {
  SecretsRepository,
  StoredSecret,
} from '../../application/secrets/SecretsRepository.js';

function toStored(row: SecretRow): StoredSecret {
  return {
    id: row.id,
    userId: row.userId,
    secretKey: row.secretKey,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DrizzleSecretsRepository implements SecretsRepository {
  constructor(private readonly db: Database) {}

  async upsert(userId: string, key: string, value: string): Promise<void> {
    const existing = await this.db
      .select()
      .from(secrets)
      .where(and(eq(secrets.userId, userId), eq(secrets.secretKey, key)))
      .limit(1);
    if (existing[0]) {
      await this.db
        .update(secrets)
        .set({ value })
        .where(and(eq(secrets.userId, userId), eq(secrets.secretKey, key)));
    } else {
      await this.db.insert(secrets).values({
        id: randomUUID(),
        userId,
        secretKey: key,
        value,
      });
    }
  }

  async getValue(userId: string, key: string): Promise<string | null> {
    const rows = await this.db
      .select()
      .from(secrets)
      .where(and(eq(secrets.userId, userId), eq(secrets.secretKey, key)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return row.value;
  }

  async delete(userId: string, key: string): Promise<boolean> {
    const res = await this.db
      .delete(secrets)
      .where(and(eq(secrets.userId, userId), eq(secrets.secretKey, key)));
    const affected = (res as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 0;
    return affected > 0;
  }

  async listKeys(userId: string): Promise<StoredSecret[]> {
    const rows = await this.db
      .select()
      .from(secrets)
      .where(eq(secrets.userId, userId));
    return rows.map(toStored);
  }
}
