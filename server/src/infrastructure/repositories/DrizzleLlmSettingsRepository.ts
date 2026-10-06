import { eq } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { isLlmServerQueue, type LlmServerQueue } from '../../domain/llm/LlmSettings.js';
import type {
  LlmSettingsRepository,
  StoredLlmSettings,
} from '../../application/llm/LlmSettingsRepository.js';
import { llmSettings } from '../db/schema.js';
import { parseJsonCol } from './jsonCol.js';

const ROW_ID = 'platform';

export class DrizzleLlmSettingsRepository implements LlmSettingsRepository {
  constructor(private readonly db: Database) {}

  async get(): Promise<StoredLlmSettings> {
    const rows = await this.db.select().from(llmSettings).where(eq(llmSettings.id, ROW_ID)).limit(1);
    const row = rows[0];
    if (!row) return { defaultModel: null, fastModel: null, serverQueues: [], updatedAt: null };
    const queues = parseJsonCol<unknown>(row.serverQueues, []);
    return {
      defaultModel: row.defaultModel ?? null,
      fastModel: row.fastModel ?? null,
      serverQueues: Array.isArray(queues)
        ? (queues.filter((q): q is LlmServerQueue => typeof q === 'string' && isLlmServerQueue(q)))
        : [],
      updatedAt: row.updatedAt,
    };
  }

  async save(input: {
    readonly defaultModel: string | null;
    readonly fastModel: string | null;
    readonly serverQueues: readonly LlmServerQueue[];
    readonly updatedBy: string;
  }): Promise<void> {
    const values = {
      defaultModel: input.defaultModel,
      fastModel: input.fastModel,
      serverQueues: [...input.serverQueues],
      updatedBy: input.updatedBy,
    };
    await this.db
      .insert(llmSettings)
      .values({ id: ROW_ID, ...values })
      .onDuplicateKeyUpdate({ set: values });
  }
}
