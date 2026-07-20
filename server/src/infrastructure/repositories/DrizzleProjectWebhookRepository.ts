import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { projectWebhooks, type ProjectWebhookRow } from '../db/schema.js';
import type {
  ProjectWebhookRecord,
  ProjectWebhookRepository,
} from '../../application/integrations/ManageWebhooks.js';
import {
  WEBHOOK_EVENT_WILDCARD,
  type WebhookEventSubscription,
} from '../../domain/integrations/ProjectWebhook.js';

// Реализация порта ProjectWebhookRepository в MariaDB (db/138). events лежат в events_json как
// JSON-массив строк; enabled — tinyint 0/1. secretHash отдаём только внутрь application (доставке).
export class DrizzleProjectWebhookRepository implements ProjectWebhookRepository {
  constructor(private readonly db: Database) {}

  private toRecord(row: ProjectWebhookRow): ProjectWebhookRecord {
    return {
      id: row.id,
      projectId: row.projectId,
      url: row.url,
      events: parseEvents(row.eventsJson),
      enabled: row.enabled === 1,
      lastStatus: row.lastStatus ?? null,
      lastAt: row.lastAt ?? null,
      createdAt: row.createdAt,
      secretHash: row.secretHash,
    };
  }

  async listByProject(projectId: string): Promise<readonly ProjectWebhookRecord[]> {
    const rows = await this.db
      .select()
      .from(projectWebhooks)
      .where(eq(projectWebhooks.projectId, projectId))
      .orderBy(projectWebhooks.createdAt);
    return rows.map((row) => this.toRecord(row));
  }

  async getById(projectId: string, id: string): Promise<ProjectWebhookRecord | null> {
    const rows = await this.db
      .select()
      .from(projectWebhooks)
      .where(and(eq(projectWebhooks.projectId, projectId), eq(projectWebhooks.id, id)))
      .limit(1);
    const row = rows[0];
    return row ? this.toRecord(row) : null;
  }

  async countByProject(projectId: string): Promise<number> {
    const rows = await this.db
      .select({ total: sql<number>`COUNT(*)` })
      .from(projectWebhooks)
      .where(eq(projectWebhooks.projectId, projectId));
    return Number(rows[0]?.total ?? 0);
  }

  async insert(record: ProjectWebhookRecord): Promise<void> {
    await this.db.insert(projectWebhooks).values({
      id: record.id,
      projectId: record.projectId,
      url: record.url,
      secretHash: record.secretHash,
      eventsJson: JSON.stringify(record.events),
      enabled: record.enabled ? 1 : 0,
      lastStatus: record.lastStatus,
      lastAt: record.lastAt,
      createdAt: record.createdAt,
    });
  }

  async update(
    projectId: string,
    id: string,
    patch: {
      readonly url?: string;
      readonly events?: readonly WebhookEventSubscription[];
      readonly enabled?: boolean;
    },
  ): Promise<ProjectWebhookRecord | null> {
    const set: Partial<typeof projectWebhooks.$inferInsert> = {};
    if (patch.url !== undefined) set.url = patch.url;
    if (patch.events !== undefined) set.eventsJson = JSON.stringify(patch.events);
    if (patch.enabled !== undefined) set.enabled = patch.enabled ? 1 : 0;
    if (Object.keys(set).length > 0) {
      await this.db
        .update(projectWebhooks)
        .set(set)
        .where(and(eq(projectWebhooks.projectId, projectId), eq(projectWebhooks.id, id)));
    }
    return this.getById(projectId, id);
  }

  async delete(projectId: string, id: string): Promise<boolean> {
    const result = await this.db
      .delete(projectWebhooks)
      .where(and(eq(projectWebhooks.projectId, projectId), eq(projectWebhooks.id, id)));
    // mysql2 driver возвращает affectedRows в result[0].
    const affected = (result as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0;
    return affected > 0;
  }

  async recordDelivery(id: string, status: string, at: string): Promise<void> {
    await this.db
      .update(projectWebhooks)
      .set({ lastStatus: status.slice(0, 64), lastAt: at.slice(0, 32) })
      .where(eq(projectWebhooks.id, id));
  }
}

// Разбор events_json в массив подписок. Некорректное содержимое → пустой список (безопасный
// дефолт: вебхук ни на что не подписан, а не «подписан на всё»).
function parseEvents(raw: string): readonly WebhookEventSubscription[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: WebhookEventSubscription[] = [];
    for (const item of parsed) {
      if (typeof item === 'string') out.push(item as WebhookEventSubscription);
    }
    if (out.includes(WEBHOOK_EVENT_WILDCARD)) return [WEBHOOK_EVENT_WILDCARD];
    return out;
  } catch {
    return [];
  }
}
