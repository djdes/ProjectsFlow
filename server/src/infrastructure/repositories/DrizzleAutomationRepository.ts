import { eq, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import type {
  AutomationConfig,
  AutomationRunStatus,
} from '../../domain/automation/Automation.js';
import type {
  AutomationRepository,
  AutomationRunState,
  SaveAutomationInput,
} from '../../application/automation/AutomationRepository.js';
import {
  projectAutomation,
  projectAutomationCriteria,
  type ProjectAutomationRow,
} from '../db/schema.js';

export class DrizzleAutomationRepository implements AutomationRepository {
  constructor(private readonly db: Database) {}

  async getConfig(projectId: string): Promise<AutomationConfig | null> {
    const [row] = await this.db
      .select()
      .from(projectAutomation)
      .where(eq(projectAutomation.projectId, projectId))
      .limit(1);
    if (!row) return null;

    const critRows = await this.db
      .select()
      .from(projectAutomationCriteria)
      .where(eq(projectAutomationCriteria.projectId, projectId));

    return {
      ...rowToConfigBase(row),
      criteria: critRows.map((c) => ({
        key: c.criterionKey,
        enabled: c.enabled,
        systemPrompt: c.systemPrompt,
        userHint: c.userHint ?? null,
      })),
    };
  }

  async saveConfig(projectId: string, input: SaveAutomationInput): Promise<void> {
    // Только конфиг-колонки; run-state (tasks_created/run_started_at/run_status/...) не трогаем —
    // им управляют resetRun / setRunStatus / recordTaskCreated.
    await this.db
      .insert(projectAutomation)
      .values({
        projectId,
        enabled: input.enabled,
        limitKind: input.limitKind,
        limitCount: input.limitCount,
        limitMinutes: input.limitMinutes,
        pauseMinSeconds: input.pauseMinSeconds,
        pauseMaxSeconds: input.pauseMaxSeconds,
        ralphMode: input.ralphMode,
        gitAuthorMode: input.gitAuthorMode,
        gitAuthorName: input.gitAuthorName,
        gitAuthorEmail: input.gitAuthorEmail,
        ignoreClaudeMd: input.ignoreClaudeMd,
        ultracodeReviewEnabled: input.ultracodeReviewEnabled,
        deployMethod: input.deployMethod,
        deployCommand: input.deployCommand,
      })
      .onDuplicateKeyUpdate({
        set: {
          enabled: input.enabled,
          limitKind: input.limitKind,
          limitCount: input.limitCount,
          limitMinutes: input.limitMinutes,
          pauseMinSeconds: input.pauseMinSeconds,
          pauseMaxSeconds: input.pauseMaxSeconds,
          ralphMode: input.ralphMode,
          gitAuthorMode: input.gitAuthorMode,
          gitAuthorName: input.gitAuthorName,
          gitAuthorEmail: input.gitAuthorEmail,
          ignoreClaudeMd: input.ignoreClaudeMd,
          ultracodeReviewEnabled: input.ultracodeReviewEnabled,
          deployMethod: input.deployMethod,
          deployCommand: input.deployCommand,
        },
      });

    // Критерии: UI всегда шлёт полный набор → upsert по (project_id, criterion_key).
    for (const c of input.criteria) {
      await this.db
        .insert(projectAutomationCriteria)
        .values({
          projectId,
          criterionKey: c.key,
          enabled: c.enabled,
          systemPrompt: c.systemPrompt,
          userHint: c.userHint,
        })
        .onDuplicateKeyUpdate({
          set: {
            enabled: c.enabled,
            systemPrompt: c.systemPrompt,
            userHint: c.userHint,
          },
        });
    }
  }

  async resetRun(projectId: string, status: AutomationRunStatus): Promise<void> {
    await this.db
      .update(projectAutomation)
      .set({
        runStatus: status,
        runStartedAt: null,
        lastTaskAt: null,
        tasksCreated: 0,
        nextCriterionIdx: 0,
      })
      .where(eq(projectAutomation.projectId, projectId));
  }

  async setRunStatus(projectId: string, status: AutomationRunStatus): Promise<void> {
    await this.db
      .update(projectAutomation)
      .set({ runStatus: status })
      .where(eq(projectAutomation.projectId, projectId));
  }

  async listEnabledProjectIds(): Promise<ReadonlyArray<string>> {
    const rows = await this.db
      .select({ projectId: projectAutomation.projectId })
      .from(projectAutomation)
      .where(eq(projectAutomation.enabled, true));
    return rows.map((r) => r.projectId);
  }

  async recordTaskCreated(projectId: string, nextIdx: number): Promise<AutomationRunState> {
    await this.db
      .update(projectAutomation)
      .set({
        tasksCreated: sql`tasks_created + 1`,
        runStartedAt: sql`COALESCE(run_started_at, CURRENT_TIMESTAMP)`,
        lastTaskAt: sql`CURRENT_TIMESTAMP`,
        nextCriterionIdx: nextIdx,
        // Первая задача переводит прогон в running (на случай если был idle).
        runStatus: sql`CASE WHEN run_status = 'idle' THEN 'running' ELSE run_status END`,
      })
      .where(eq(projectAutomation.projectId, projectId));

    const [row] = await this.db
      .select()
      .from(projectAutomation)
      .where(eq(projectAutomation.projectId, projectId))
      .limit(1);
    if (!row) throw new Error(`project_automation row ${projectId} disappeared after record`);

    return {
      runStatus: row.runStatus,
      runStartedAt: row.runStartedAt ?? null,
      tasksCreated: row.tasksCreated,
      lastTaskAt: row.lastTaskAt ?? null,
      nextCriterionIdx: row.nextCriterionIdx,
    };
  }
}

function rowToConfigBase(row: ProjectAutomationRow): Omit<AutomationConfig, 'criteria'> {
  return {
    projectId: row.projectId,
    enabled: row.enabled,
    limitKind: row.limitKind,
    limitCount: row.limitCount ?? null,
    limitMinutes: row.limitMinutes ?? null,
    pauseMinSeconds: row.pauseMinSeconds,
    pauseMaxSeconds: row.pauseMaxSeconds,
    ralphMode: row.ralphMode,
    gitAuthorMode: row.gitAuthorMode,
    gitAuthorName: row.gitAuthorName ?? null,
    gitAuthorEmail: row.gitAuthorEmail ?? null,
    ignoreClaudeMd: row.ignoreClaudeMd,
    ultracodeReviewEnabled: row.ultracodeReviewEnabled,
    deployMethod: row.deployMethod,
    deployCommand: row.deployCommand ?? null,
    runStatus: row.runStatus,
    runStartedAt: row.runStartedAt ?? null,
    tasksCreated: row.tasksCreated,
    lastTaskAt: row.lastTaskAt ?? null,
    nextCriterionIdx: row.nextCriterionIdx,
  };
}
