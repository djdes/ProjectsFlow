import { and, eq, isNotNull, or } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import {
  projectDigestSettings,
  projects,
  workspaceAssigneeDigestSettings,
  type WorkspaceAssigneeDigestSettingsRow,
} from '../db/schema.js';
import type {
  SaveWorkspaceAssigneeDigestSettingsInput,
  WorkspaceAssigneeDigestRepository,
} from '../../application/digest/WorkspaceAssigneeDigestRepository.js';
import type {
  DigestGroupHistory,
  DigestTestDelivery,
} from '../../application/digest/DigestSettingsRepository.js';
import {
  defaultWorkspaceAssigneeDigestSettings,
  type WorkspaceAssigneeDigestSettings,
} from '../../domain/digest/WorkspaceAssigneeDigestSettings.js';
import { parseJsonCol } from './jsonCol.js';
import {
  ALL_SCHEDULE_DAYS,
  WEEKDAY_SCHEDULE_DAYS,
  isWeekdaysOnly,
  normalizeScheduleDays,
} from '../../domain/digest/ScheduleDays.js';

function rowToSettings(
  row: WorkspaceAssigneeDigestSettingsRow,
): WorkspaceAssigneeDigestSettings {
  return {
    workspaceId: row.workspaceId,
    enabled: row.enabled,
    hour: row.sendHour,
    minute: row.sendMinute,
    daysOfWeek: normalizeScheduleDays(
      parseJsonCol<unknown[]>(row.daysOfWeek, []),
      row.weekdaysOnly ? WEEKDAY_SCHEDULE_DAYS : ALL_SCHEDULE_DAYS,
    ),
    telegramGroupChatId: row.telegramGroupChatId ?? null,
    telegramGroupTitle: row.telegramGroupTitle ?? null,
    recipientMode: row.recipientMode,
    recipientUserIds: parseJsonCol<string[]>(row.recipientUserIds, []),
    projectMode: row.projectMode,
    projectIds: parseJsonCol<string[]>(row.projectIds, []),
    commitSyncEnabled: row.commitSyncEnabled,
    commitSyncHour: row.commitSyncHour,
    commitSyncMinute: row.commitSyncMinute,
    commitSyncAction: row.commitSyncAction,
    commitSyncLastSentOn: row.commitSyncLastSentOn ?? null,
    eodReminderEnabled: row.eodReminderEnabled,
    eodReminderHour: row.eodReminderHour,
    eodReminderMinute: row.eodReminderMinute,
    eodReminderLastSentOn: row.eodReminderLastSentOn ?? null,
    lastSentOn: row.lastSentOn ?? null,
  };
}

function parseDeliveries(value: unknown): DigestTestDelivery[] {
  const raw = parseJsonCol<unknown[]>(value, []);
  const result: DigestTestDelivery[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as { chatId?: unknown; messageIds?: unknown };
    if (typeof candidate.chatId !== 'number' || !Array.isArray(candidate.messageIds)) continue;
    const messageIds = candidate.messageIds.filter(
      (id): id is number => typeof id === 'number' && Number.isInteger(id) && id > 0,
    );
    if (messageIds.length > 0) result.push({ chatId: candidate.chatId, messageIds });
  }
  return result;
}

export class DrizzleWorkspaceAssigneeDigestRepository
  implements WorkspaceAssigneeDigestRepository
{
  constructor(private readonly db: Database) {}

  async get(workspaceId: string): Promise<WorkspaceAssigneeDigestSettings> {
    const [row] = await this.db
      .select()
      .from(workspaceAssigneeDigestSettings)
      .where(eq(workspaceAssigneeDigestSettings.workspaceId, workspaceId))
      .limit(1);
    return row
      ? rowToSettings(row)
      : defaultWorkspaceAssigneeDigestSettings(workspaceId);
  }

  async save(
    workspaceId: string,
    input: SaveWorkspaceAssigneeDigestSettingsInput,
  ): Promise<WorkspaceAssigneeDigestSettings> {
    const set = {
      enabled: input.enabled,
      sendHour: input.hour,
      sendMinute: input.minute,
      weekdaysOnly: isWeekdaysOnly(input.daysOfWeek),
      daysOfWeek: input.daysOfWeek,
      telegramGroupChatId: input.telegramGroupChatId,
      telegramGroupTitle: input.telegramGroupTitle,
      recipientMode: input.recipientMode,
      recipientUserIds: input.recipientUserIds,
      projectMode: input.projectMode,
      projectIds: input.projectIds,
      commitSyncEnabled: input.commitSyncEnabled,
      commitSyncHour: input.commitSyncHour,
      commitSyncMinute: input.commitSyncMinute,
      commitSyncAction: input.commitSyncAction,
      eodReminderEnabled: input.eodReminderEnabled,
      eodReminderHour: input.eodReminderHour,
      eodReminderMinute: input.eodReminderMinute,
    };
    await this.db
      .insert(workspaceAssigneeDigestSettings)
      .values({ workspaceId, ...set })
      .onDuplicateKeyUpdate({ set });
    return this.get(workspaceId);
  }

  async listEnabled(): Promise<WorkspaceAssigneeDigestSettings[]> {
    const rows = await this.db
      .select()
      .from(workspaceAssigneeDigestSettings)
      .where(eq(workspaceAssigneeDigestSettings.enabled, true));
    return rows.map(rowToSettings);
  }

  async listScheduled(): Promise<WorkspaceAssigneeDigestSettings[]> {
    const rows = await this.db
      .select()
      .from(workspaceAssigneeDigestSettings)
      .where(
        or(
          eq(workspaceAssigneeDigestSettings.enabled, true),
          eq(workspaceAssigneeDigestSettings.commitSyncEnabled, true),
          eq(workspaceAssigneeDigestSettings.eodReminderEnabled, true),
        ),
      );
    return rows.map(rowToSettings);
  }

  async markSent(workspaceId: string, dateMsk: string): Promise<void> {
    await this.db
      .update(workspaceAssigneeDigestSettings)
      .set({ lastSentOn: dateMsk })
      .where(eq(workspaceAssigneeDigestSettings.workspaceId, workspaceId));
  }

  async markCommitSyncSent(workspaceId: string, dateMsk: string): Promise<void> {
    await this.db
      .update(workspaceAssigneeDigestSettings)
      .set({ commitSyncLastSentOn: dateMsk })
      .where(eq(workspaceAssigneeDigestSettings.workspaceId, workspaceId));
  }

  async markEodReminderSent(workspaceId: string, dateMsk: string): Promise<void> {
    await this.db
      .update(workspaceAssigneeDigestSettings)
      .set({ eodReminderLastSentOn: dateMsk })
      .where(eq(workspaceAssigneeDigestSettings.workspaceId, workspaceId));
  }

  async getLastTestDeliveries(workspaceId: string): Promise<DigestTestDelivery[]> {
    const [row] = await this.db
      .select({ deliveries: workspaceAssigneeDigestSettings.testDeliveries })
      .from(workspaceAssigneeDigestSettings)
      .where(eq(workspaceAssigneeDigestSettings.workspaceId, workspaceId))
      .limit(1);
    return parseDeliveries(row?.deliveries);
  }

  async replaceLastTestDeliveries(
    workspaceId: string,
    deliveries: readonly DigestTestDelivery[],
  ): Promise<void> {
    const value = deliveries.map((delivery) => ({
      chatId: delivery.chatId,
      messageIds: [...new Set(delivery.messageIds)].sort((a, b) => a - b),
    }));
    await this.db
      .insert(workspaceAssigneeDigestSettings)
      .values({ workspaceId, testDeliveries: value })
      .onDuplicateKeyUpdate({ set: { testDeliveries: value } });
  }

  async listGroups(workspaceId: string): Promise<DigestGroupHistory[]> {
    const rows = await this.db
      .select({
        chatId: projectDigestSettings.telegramGroupChatId,
        title: projectDigestSettings.telegramGroupTitle,
      })
      .from(projectDigestSettings)
      .innerJoin(projects, eq(projects.id, projectDigestSettings.projectId))
      .where(
        and(
          eq(projects.workspaceId, workspaceId),
          isNotNull(projectDigestSettings.telegramGroupChatId),
        ),
      );
    const current = await this.get(workspaceId);
    const byId = new Map<number, DigestGroupHistory>();
    if (current.telegramGroupChatId !== null) {
      byId.set(current.telegramGroupChatId, {
        chatId: current.telegramGroupChatId,
        title: current.telegramGroupTitle,
      });
    }
    for (const row of rows) {
      if (row.chatId === null) continue;
      const existing = byId.get(row.chatId);
      if (!existing || (!existing.title && row.title)) {
        byId.set(row.chatId, { chatId: row.chatId, title: row.title ?? null });
      }
    }
    return [...byId.values()].sort((a, b) => {
      if (!!a.title !== !!b.title) return a.title ? -1 : 1;
      return a.chatId - b.chatId;
    });
  }
}
