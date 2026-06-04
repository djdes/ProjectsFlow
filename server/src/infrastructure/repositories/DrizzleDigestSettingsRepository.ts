import { eq } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { projectDigestSettings, type ProjectDigestSettingsRow } from '../db/schema.js';
import type {
  DigestSettingsRepository,
  SaveDigestSettingsInput,
} from '../../application/digest/DigestSettingsRepository.js';
import {
  defaultDigestSettings,
  type DigestChannelKind,
  type DigestSettings,
  type DigestTgTarget,
} from '../../domain/digest/DigestSettings.js';
import type { TaskStatus } from '../../domain/task/Task.js';
import { parseJsonCol } from './jsonCol.js';

function rowToSettings(row: ProjectDigestSettingsRow): DigestSettings {
  const def = defaultDigestSettings(row.projectId);
  return {
    projectId: row.projectId,
    telegramGroupChatId: row.telegramGroupChatId ?? null,
    telegramGroupTitle: row.telegramGroupTitle ?? null,
    daily: {
      enabled: row.dailyEnabled,
      hour: row.dailyHour,
      minute: row.dailyMinute,
      recipientUserIds: parseJsonCol<string[]>(row.dailyRecipients, []),
      channels: parseJsonCol<DigestChannelKind[]>(row.dailyChannels, def.daily.channels),
      tgTargets: parseJsonCol<DigestTgTarget[]>(row.dailyTgTargets, def.daily.tgTargets),
      statuses: parseJsonCol<TaskStatus[]>(row.dailyStatuses, def.daily.statuses),
    },
    dailyLastSentOn: row.dailyLastSentOn ?? null,
  };
}

export class DrizzleDigestSettingsRepository implements DigestSettingsRepository {
  constructor(private readonly db: Database) {}

  async getByProject(projectId: string): Promise<DigestSettings> {
    const [row] = await this.db
      .select()
      .from(projectDigestSettings)
      .where(eq(projectDigestSettings.projectId, projectId))
      .limit(1);
    return row ? rowToSettings(row) : defaultDigestSettings(projectId);
  }

  async save(projectId: string, input: SaveDigestSettingsInput): Promise<DigestSettings> {
    const set = {
      telegramGroupChatId: input.telegramGroupChatId,
      telegramGroupTitle: input.telegramGroupTitle,
      dailyEnabled: input.daily.enabled,
      dailyHour: input.daily.hour,
      dailyMinute: input.daily.minute,
      dailyRecipients: input.daily.recipientUserIds,
      dailyChannels: input.daily.channels,
      dailyTgTargets: input.daily.tgTargets,
      dailyStatuses: input.daily.statuses,
    };
    await this.db
      .insert(projectDigestSettings)
      .values({ projectId, ...set })
      .onDuplicateKeyUpdate({ set });
    return this.getByProject(projectId);
  }

  async listDailyEnabled(): Promise<DigestSettings[]> {
    const rows = await this.db
      .select()
      .from(projectDigestSettings)
      .where(eq(projectDigestSettings.dailyEnabled, true));
    return rows.map(rowToSettings);
  }

  async markDailySent(projectId: string, dateMsk: string): Promise<void> {
    await this.db
      .update(projectDigestSettings)
      .set({ dailyLastSentOn: dateMsk })
      .where(eq(projectDigestSettings.projectId, projectId));
  }
}
