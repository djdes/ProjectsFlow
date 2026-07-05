import { and, eq, isNotNull } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import {
  projectDigestSettings,
  projectMembers,
  projects,
  type ProjectDigestSettingsRow,
} from '../db/schema.js';
import type {
  DigestGroupHistory,
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
      weekdaysOnly: row.dailyWeekdaysOnly,
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

  async listGroupsForUser(userId: string, projectId: string): Promise<DigestGroupHistory[]> {
    // Подсказки «ранее введённые группы» = объединение двух выборок (обе с непустым chat_id):
    //  (A) группы из всех проектов, где юзер — участник (любое пространство) — JOIN на
    //      project_members гейтит выдачу его проектами;
    //  (B) группы из всех проектов ПРОСТРАНСТВА текущего проекта — т.е. то, что вводили
    //      другие участники пространства. Доступ к проекту = участник пространства, поэтому
    //      светить группы в пределах одного пространства безопасно.
    const selectCols = {
      chatId: projectDigestSettings.telegramGroupChatId,
      title: projectDigestSettings.telegramGroupTitle,
    } as const;

    // (A) — мои проекты.
    const mine = await this.db
      .select(selectCols)
      .from(projectDigestSettings)
      .innerJoin(projectMembers, eq(projectMembers.projectId, projectDigestSettings.projectId))
      .where(
        and(
          eq(projectMembers.userId, userId),
          isNotNull(projectDigestSettings.telegramGroupChatId),
        ),
      );

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
