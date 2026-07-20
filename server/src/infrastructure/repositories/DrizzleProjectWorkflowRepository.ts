import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { projectWorkflows, type ProjectWorkflowRow } from '../db/schema.js';
import type { ProjectWorkflowRepository } from '../../application/automation/ManageWorkflows.js';
import {
  normalizeWorkflowAction,
  normalizeWorkflowTrigger,
  type WorkflowAction,
  type WorkflowRule,
  type WorkflowTrigger,
} from '../../domain/automation/WorkflowRule.js';

// Реализация порта ProjectWorkflowRepository в MariaDB (db/139). trigger/action лежат в
// trigger_json/action_json как сериализованные discriminated-union; читаются через доменные
// нормализаторы (валидируют по замкнутому набору — битая/устаревшая строка не пролезет).
export class DrizzleProjectWorkflowRepository implements ProjectWorkflowRepository {
  constructor(private readonly db: Database) {}

  private toRule(row: ProjectWorkflowRow): WorkflowRule {
    return {
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      trigger: parseTrigger(row.triggerJson),
      action: parseAction(row.actionJson),
      enabled: row.enabled === 1,
      lastStatus: row.lastStatus ?? null,
      lastRunAt: row.lastRunAt ?? null,
      createdAt: row.createdAt,
    };
  }

  async listByProject(projectId: string): Promise<readonly WorkflowRule[]> {
    const rows = await this.db
      .select()
      .from(projectWorkflows)
      .where(eq(projectWorkflows.projectId, projectId))
      .orderBy(projectWorkflows.createdAt);
    return rows.map((row) => this.toRule(row));
  }

  async getById(projectId: string, id: string): Promise<WorkflowRule | null> {
    const rows = await this.db
      .select()
      .from(projectWorkflows)
      .where(and(eq(projectWorkflows.projectId, projectId), eq(projectWorkflows.id, id)))
      .limit(1);
    const row = rows[0];
    return row ? this.toRule(row) : null;
  }

  async countByProject(projectId: string): Promise<number> {
    const rows = await this.db
      .select({ total: sql<number>`COUNT(*)` })
      .from(projectWorkflows)
      .where(eq(projectWorkflows.projectId, projectId));
    return Number(rows[0]?.total ?? 0);
  }

  async insert(rule: WorkflowRule): Promise<void> {
    await this.db.insert(projectWorkflows).values({
      id: rule.id,
      projectId: rule.projectId,
      name: rule.name,
      triggerJson: JSON.stringify(rule.trigger),
      actionJson: JSON.stringify(rule.action),
      enabled: rule.enabled ? 1 : 0,
      lastStatus: rule.lastStatus,
      lastRunAt: rule.lastRunAt,
      createdAt: rule.createdAt,
    });
  }

  async update(
    projectId: string,
    id: string,
    patch: {
      readonly name?: string;
      readonly trigger?: WorkflowTrigger;
      readonly action?: WorkflowAction;
      readonly enabled?: boolean;
    },
  ): Promise<WorkflowRule | null> {
    const set: Partial<typeof projectWorkflows.$inferInsert> = {};
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.trigger !== undefined) set.triggerJson = JSON.stringify(patch.trigger);
    if (patch.action !== undefined) set.actionJson = JSON.stringify(patch.action);
    if (patch.enabled !== undefined) set.enabled = patch.enabled ? 1 : 0;
    if (Object.keys(set).length > 0) {
      await this.db
        .update(projectWorkflows)
        .set(set)
        .where(and(eq(projectWorkflows.projectId, projectId), eq(projectWorkflows.id, id)));
    }
    return this.getById(projectId, id);
  }

  async delete(projectId: string, id: string): Promise<boolean> {
    const result = await this.db
      .delete(projectWorkflows)
      .where(and(eq(projectWorkflows.projectId, projectId), eq(projectWorkflows.id, id)));
    // mysql2 driver возвращает affectedRows в result[0].
    const affected = (result as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0;
    return affected > 0;
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    await this.db
      .update(projectWorkflows)
      .set({ enabled: enabled ? 1 : 0 })
      .where(eq(projectWorkflows.id, id));
  }

  async recordRun(id: string, status: string, at: string): Promise<void> {
    await this.db
      .update(projectWorkflows)
      .set({ lastStatus: status.slice(0, 64), lastRunAt: at.slice(0, 32) })
      .where(eq(projectWorkflows.id, id));
  }
}

// Разбор trigger_json/action_json через доменные нормализаторы. Битую строку заменяем
// безопасным дефолтом, который НЕ срабатывает и НЕ делает ничего разрушительного:
// триггер webhook_received с невозможным ключом + действие-заглушка send_telegram.
function parseTrigger(raw: string): WorkflowTrigger {
  try {
    return normalizeWorkflowTrigger(JSON.parse(raw));
  } catch {
    return { type: 'webhook_received', key: '__invalid__' };
  }
}

function parseAction(raw: string): WorkflowAction {
  try {
    return normalizeWorkflowAction(JSON.parse(raw));
  } catch {
    return { type: 'send_telegram', message: '(правило повреждено)' };
  }
}
