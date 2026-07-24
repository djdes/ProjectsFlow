import { and, eq, sql } from 'drizzle-orm';
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
  projects,
  type ProjectAutomationRow,
} from '../db/schema.js';

// Дни недели сверки: 0..6. NULL/битый JSON/пусто → «каждый день». Дубли и мусор отсекаем,
// чтобы кривая строка в БД не уронила планировщик.
const ALL_DAYS: readonly number[] = [0, 1, 2, 3, 4, 5, 6];
function parseCommitSyncDays(json: string | null | undefined): number[] {
  if (!json) return [...ALL_DAYS];
  try {
    const value: unknown = JSON.parse(json);
    if (!Array.isArray(value)) return [...ALL_DAYS];
    const days = [...new Set(value.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
    return days.length > 0 ? days : [...ALL_DAYS];
  } catch {
    return [...ALL_DAYS];
  }
}

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
    // Changing the commit-sync schedule re-arms today's run. The scheduler skips a project whose
    // last_run_on is today, so without this a same-day time change would never fire — the user must
    // be able to retrigger the digest by moving the time. We clear last_run_on ONLY when the time
    // or the enabled flag actually changed (compared against the STORED row before the upsert
    // overwrites it): an unrelated save (dispatcher, deploy) must not silently re-fire commit sync.
    await this.db
      .update(projectAutomation)
      .set({ commitSyncLastRunOn: null })
      .where(
        and(
          eq(projectAutomation.projectId, projectId),
          sql`(commit_sync_hour <> ${input.commitSyncHour} OR commit_sync_minute <> ${input.commitSyncMinute} OR commit_sync_enabled <> ${input.commitSyncEnabled})`,
        ),
      );

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
        // commit-sync: 4 редактируемых поля. last_run_on НЕ трогаем — им владеет планировщик.
        commitSyncEnabled: input.commitSyncEnabled,
        commitSyncHour: input.commitSyncHour,
        commitSyncMinute: input.commitSyncMinute,
        commitSyncDays: JSON.stringify([...input.commitSyncDaysOfWeek]),
        commitSyncThresholdHours: input.commitSyncThresholdHours,
        commitSyncAction: input.commitSyncAction,
        assigneeDigestEnabled: input.assigneeDigestEnabled,
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
          commitSyncEnabled: input.commitSyncEnabled,
          commitSyncHour: input.commitSyncHour,
          commitSyncMinute: input.commitSyncMinute,
          commitSyncDays: JSON.stringify([...input.commitSyncDaysOfWeek]),
          commitSyncThresholdHours: input.commitSyncThresholdHours,
          commitSyncAction: input.commitSyncAction,
          assigneeDigestEnabled: input.assigneeDigestEnabled,
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

  async listAssigneeDigestProjectIds(workspaceId: string): Promise<ReadonlyArray<string>> {
    const rows = await this.db
      .select({ projectId: projectAutomation.projectId })
      .from(projectAutomation)
      .innerJoin(projects, eq(projects.id, projectAutomation.projectId))
      .where(
        and(
          eq(projects.workspaceId, workspaceId),
          eq(projectAutomation.assigneeDigestEnabled, true),
        ),
      );
    return rows.map((row) => row.projectId);
  }

  async listCommitSyncEnabled(): Promise<
    ReadonlyArray<{
      projectId: string;
      hour: number;
      minute: number;
      daysOfWeek: readonly number[];
      lastRunOn: string | null;
    }>
  > {
    const rows = await this.db
      .select({
        projectId: projectAutomation.projectId,
        hour: projectAutomation.commitSyncHour,
        minute: projectAutomation.commitSyncMinute,
        days: projectAutomation.commitSyncDays,
        lastRunOn: projectAutomation.commitSyncLastRunOn,
      })
      .from(projectAutomation)
      .where(eq(projectAutomation.commitSyncEnabled, true));
    return rows.map((r) => ({
      projectId: r.projectId,
      hour: r.hour,
      minute: r.minute,
      daysOfWeek: parseCommitSyncDays(r.days),
      lastRunOn: r.lastRunOn ?? null,
    }));
  }

  // Массовое включение сверки по всему пространству (мастер-действие). Создаёт строку
  // project_automation, если её не было (insert-if-not-exists), и проставляет enabled/время/дни.
  // Остальные поля новой строки берут дефолты БД. Затрагивает только проекты этого пространства.
  async bulkSetCommitSync(
    workspaceId: string,
    input: {
      enabled: boolean;
      hour: number;
      minute: number;
      daysOfWeek: readonly number[];
      action: 'propose' | 'auto';
    },
  ): Promise<number> {
    const rows = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.workspaceId, workspaceId));
    const days = JSON.stringify([...input.daysOfWeek]);
    for (const { id } of rows) {
      await this.db
        .insert(projectAutomation)
        .values({
          projectId: id,
          commitSyncEnabled: input.enabled,
          commitSyncHour: input.hour,
          commitSyncMinute: input.minute,
          commitSyncDays: days,
          commitSyncAction: input.action,
        })
        .onDuplicateKeyUpdate({
          set: {
            commitSyncEnabled: input.enabled,
            commitSyncHour: input.hour,
            commitSyncMinute: input.minute,
            commitSyncDays: days,
            commitSyncAction: input.action,
            // «Применить ко всем» — осознанное «запустить по этому расписанию», поэтому
            // снимаем отметку «запущено сегодня» у всех проектов: смена времени должна
            // приводить к запуску (в т.ч. повторно в тот же день).
            commitSyncLastRunOn: null,
          },
        });
    }
    return rows.length;
  }

  async markCommitSyncRun(projectId: string, dateMsk: string): Promise<void> {
    await this.db
      .update(projectAutomation)
      .set({ commitSyncLastRunOn: dateMsk })
      .where(eq(projectAutomation.projectId, projectId));
  }

  async ensureDefaultRow(projectId: string): Promise<void> {
    // Insert-if-not-exists: остальные колонки берут дефолты БД (db/101 — автоматизации ВКЛ).
    await this.db
      .insert(projectAutomation)
      .values({ projectId })
      .onDuplicateKeyUpdate({ set: { projectId } });
  }

  async listEodReminderEnabled(): Promise<
    ReadonlyArray<{
      projectId: string;
      hour: number;
      minute: number;
      lastRunOn: string | null;
    }>
  > {
    const rows = await this.db
      .select({
        projectId: projectAutomation.projectId,
        hour: projectAutomation.eodReminderHour,
        minute: projectAutomation.eodReminderMinute,
        lastRunOn: projectAutomation.eodReminderLastRunOn,
      })
      .from(projectAutomation)
      .where(eq(projectAutomation.eodReminderEnabled, true));
    return rows.map((r) => ({
      projectId: r.projectId,
      hour: r.hour,
      minute: r.minute,
      lastRunOn: r.lastRunOn ?? null,
    }));
  }

  async markEodReminderRun(projectId: string, dateMsk: string): Promise<void> {
    await this.db
      .update(projectAutomation)
      .set({ eodReminderLastRunOn: dateMsk })
      .where(eq(projectAutomation.projectId, projectId));
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
    commitSyncEnabled: row.commitSyncEnabled,
    commitSyncHour: row.commitSyncHour,
    commitSyncMinute: row.commitSyncMinute,
    commitSyncDaysOfWeek: parseCommitSyncDays(row.commitSyncDays),
    commitSyncThresholdHours: row.commitSyncThresholdHours,
    commitSyncLastRunOn: row.commitSyncLastRunOn ?? null,
    commitSyncAction: row.commitSyncAction,
    eodReminderEnabled: row.eodReminderEnabled,
    eodReminderHour: row.eodReminderHour,
    eodReminderMinute: row.eodReminderMinute,
    eodReminderLastRunOn: row.eodReminderLastRunOn ?? null,
    dailyPlanEnabled: row.dailyPlanEnabled,
    assigneeDigestEnabled: row.assigneeDigestEnabled,
  };
}
