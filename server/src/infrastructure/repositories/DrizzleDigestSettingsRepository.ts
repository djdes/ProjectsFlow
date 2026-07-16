import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import {
  projectDigestSettings,
  projects,
  type ProjectDigestSettingsRow,
} from '../db/schema.js';
import type {
  DigestGroupHistory,
  DigestSettingsRepository,
  DigestTestDelivery,
  SaveDigestSettingsInput,
} from '../../application/digest/DigestSettingsRepository.js';
import {
  defaultDigestSettings,
  type DigestChannelKind,
  type DigestSettings,
  type DigestTgGrouping,
  type DigestTgTarget,
} from '../../domain/digest/DigestSettings.js';
import type { TaskStatus } from '../../domain/task/Task.js';
// Скоуп «мои проекты» (ветка А) — через единое пространство (workspace_members,
// is_inbox→owner), НЕ project_members (тот же класс бага, что #блокер3..5/ef0cea3) —
// переиспользуем ProjectMemberRepository (эталон DrizzleProjectMemberRepository) вместо
// прямого JOIN на project_members: ws-приглашённый юзер без ленивой project_members-строки
// получал бы пустую ветку А.
import type { ProjectMemberRepository } from '../../application/project/ProjectMemberRepository.js';
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
      tgGrouping:
        row.dailyTgGrouping === 'assignee'
          ? ('assignee' as DigestTgGrouping)
          : def.daily.tgGrouping,
      statuses: parseJsonCol<TaskStatus[]>(row.dailyStatuses, def.daily.statuses),
      weekdaysOnly: row.dailyWeekdaysOnly,
    },
    dailyLastSentOn: row.dailyLastSentOn ?? null,
  };
}

export class DrizzleDigestSettingsRepository implements DigestSettingsRepository {
  constructor(
    private readonly db: Database,
    private readonly projectMembers: ProjectMemberRepository,
  ) {}

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
      dailyTgGrouping: input.daily.tgGrouping,
      dailyStatuses: input.daily.statuses,
      dailyWeekdaysOnly: input.daily.weekdaysOnly,
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

  async getLastTestDeliveries(projectId: string): Promise<DigestTestDelivery[]> {
    const [row] = await this.db
      .select({ deliveries: projectDigestSettings.dailyTestDeliveries })
      .from(projectDigestSettings)
      .where(eq(projectDigestSettings.projectId, projectId))
      .limit(1);
    const raw = parseJsonCol<unknown[]>(row?.deliveries, []);
    const result: DigestTestDelivery[] = [];
    for (const value of raw) {
      if (!value || typeof value !== 'object') continue;
      const candidate = value as { chatId?: unknown; messageIds?: unknown };
      if (typeof candidate.chatId !== 'number' || !Array.isArray(candidate.messageIds)) continue;
      const messageIds = candidate.messageIds.filter(
        (id): id is number => typeof id === 'number' && Number.isInteger(id) && id > 0,
      );
      if (messageIds.length > 0) result.push({ chatId: candidate.chatId, messageIds });
    }
    return result;
  }

  async replaceLastTestDeliveries(
    projectId: string,
    deliveries: readonly DigestTestDelivery[],
  ): Promise<void> {
    const value = deliveries.map((delivery) => ({
      chatId: delivery.chatId,
      messageIds: [...new Set(delivery.messageIds)].sort((a, b) => a - b),
    }));
    await this.db
      .insert(projectDigestSettings)
      .values({ projectId, dailyTestDeliveries: value })
      .onDuplicateKeyUpdate({ set: { dailyTestDeliveries: value } });
  }

  async listGroupsForUser(userId: string, projectId: string): Promise<DigestGroupHistory[]> {
    // Подсказки «ранее введённые группы» = объединение двух выборок (обе с непустым chat_id):
    //  (A) группы из всех проектов, где юзер — участник (любое пространство) —
    //      ProjectMemberRepository.listProjectsForUser гейтит выдачу его проектами;
    //  (B) группы из всех проектов ПРОСТРАНСТВА текущего проекта — т.е. то, что вводили
    //      другие участники пространства. Доступ к проекту = участник пространства, поэтому
    //      светить группы в пределах одного пространства безопасно.
    const selectCols = {
      chatId: projectDigestSettings.telegramGroupChatId,
      title: projectDigestSettings.telegramGroupTitle,
    } as const;

    // (A) — мои проекты.
    const accessibleIds = (await this.projectMembers.listProjectsForUser(userId)).map(
      (p) => p.id,
    );
    const mine = accessibleIds.length
      ? await this.db
          .select(selectCols)
          .from(projectDigestSettings)
          .where(
            and(
              inArray(projectDigestSettings.projectId, accessibleIds),
              isNotNull(projectDigestSettings.telegramGroupChatId),
            ),
          )
      : [];

    // (B) — все проекты пространства текущего проекта. workspace_id резолвим по projectId.
    const [cur] = await this.db
      .select({ workspaceId: projects.workspaceId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    const workspace = cur
      ? await this.db
          .select(selectCols)
          .from(projectDigestSettings)
          .innerJoin(projects, eq(projects.id, projectDigestSettings.projectId))
          .where(
            and(
              eq(projects.workspaceId, cur.workspaceId),
              isNotNull(projectDigestSettings.telegramGroupChatId),
            ),
          )
      : [];

    // Один и тот же chat_id может встречаться в нескольких проектах/обеих выборках —
    // дедуплицируем, предпочитая запись с непустым названием.
    const byId = new Map<number, DigestGroupHistory>();
    for (const r of [...mine, ...workspace]) {
      if (r.chatId === null) continue;
      const title = r.title ?? null;
      const existing = byId.get(r.chatId);
      if (!existing || (!existing.title && title)) {
        byId.set(r.chatId, { chatId: r.chatId, title });
      }
    }
    // Стабильный порядок: с названием выше, затем по chat_id.
    return [...byId.values()].sort((a, b) => {
      if (!!a.title !== !!b.title) return a.title ? -1 : 1;
      return a.chatId - b.chatId;
    });
  }
}
