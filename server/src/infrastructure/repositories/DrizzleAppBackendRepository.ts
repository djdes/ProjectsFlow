import { eq } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { appBackends } from '../db/schema.js';
import { parseJsonCol } from './jsonCol.js';
import type { AppBackend } from '../../domain/app-backend/AppBackend.js';
import type { AppSchema } from '../../domain/app-backend/AppSchema.js';
import type {
  AppBackendRepository,
  UpsertAppBackendInput,
} from '../../application/app-backend/AppBackendRepository.js';

type Row = typeof appBackends.$inferSelect;

function toAppBackend(row: Row): AppBackend {
  return {
    projectId: row.projectId,
    status: row.status,
    schema: parseJsonCol<AppSchema | null>(row.schemaJson, null),
    appKeyHash: row.appKeyHash ?? null,
    usageBytes: Number(row.usageBytes),
    storageLimitBytes: Number(row.storageLimitBytes),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DrizzleAppBackendRepository implements AppBackendRepository {
  constructor(private readonly db: Database) {}

  async getByProject(projectId: string): Promise<AppBackend | null> {
    const rows = await this.db
      .select()
      .from(appBackends)
      .where(eq(appBackends.projectId, projectId))
      .limit(1);
    const row = rows[0];
    return row ? toAppBackend(row) : null;
  }

  async upsert(input: UpsertAppBackendInput): Promise<AppBackend> {
    const schemaStr = input.schema ? JSON.stringify(input.schema) : null;
    const limitPatch =
      input.storageLimitBytes !== undefined ? { storageLimitBytes: input.storageLimitBytes } : {};
    await this.db
      .insert(appBackends)
      .values({
        projectId: input.projectId,
        status: input.status,
        schemaJson: schemaStr,
        appKeyHash: input.appKeyHash,
        ...limitPatch,
      })
      .onDuplicateKeyUpdate({
        set: {
          status: input.status,
          schemaJson: schemaStr,
          appKeyHash: input.appKeyHash,
          ...limitPatch,
        },
      });
    const saved = await this.getByProject(input.projectId);
    if (!saved) throw new Error('Failed to read back app_backend after upsert');
    return saved;
  }

  async setUsage(projectId: string, usageBytes: number): Promise<void> {
    await this.db
      .update(appBackends)
      .set({ usageBytes })
      .where(eq(appBackends.projectId, projectId));
  }
}
