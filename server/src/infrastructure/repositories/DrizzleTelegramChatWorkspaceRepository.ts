import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import {
  projectDigestSettings,
  projects,
  telegramChatWorkspaces,
  workspaceAssigneeDigestSettings,
} from '../db/schema.js';
import type {
  TelegramChatWorkspaceChoice,
  TelegramChatWorkspaceRepository,
} from '../../application/telegram/TelegramChatWorkspaceRepository.js';

export class DrizzleTelegramChatWorkspaceRepository implements TelegramChatWorkspaceRepository {
  constructor(private readonly db: Database) {}

  async linkedWorkspaceIds(tgChatId: number): Promise<string[]> {
    const [byProject, byWorkspace] = await Promise.all([
      this.db
        .selectDistinct({ workspaceId: projects.workspaceId })
        .from(projectDigestSettings)
        .innerJoin(projects, eq(projects.id, projectDigestSettings.projectId))
        .where(eq(projectDigestSettings.telegramGroupChatId, tgChatId)),
      this.db
        .select({ workspaceId: workspaceAssigneeDigestSettings.workspaceId })
        .from(workspaceAssigneeDigestSettings)
        .where(eq(workspaceAssigneeDigestSettings.telegramGroupChatId, tgChatId)),
    ]);
    return [...new Set([...byProject, ...byWorkspace].map((row) => row.workspaceId))];
  }

  async getChoice(tgChatId: number, userId: string): Promise<TelegramChatWorkspaceChoice | null> {
    const rows = await this.db
      .select()
      .from(telegramChatWorkspaces)
      .where(
        and(eq(telegramChatWorkspaces.tgChatId, tgChatId), eq(telegramChatWorkspaces.userId, userId)),
      )
      .limit(1);
    const row = rows[0];
    return row ? { workspaceId: row.workspaceId, chosenAt: row.chosenAt } : null;
  }

  async saveChoice(tgChatId: number, userId: string, workspaceId: string): Promise<void> {
    await this.db
      .insert(telegramChatWorkspaces)
      .values({ tgChatId, userId, workspaceId })
      .onDuplicateKeyUpdate({ set: { workspaceId, chosenAt: sql`CURRENT_TIMESTAMP` } });
  }
}
