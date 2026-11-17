import { desc, eq } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { workspaceTaskTemplates, type WorkspaceTaskTemplateRow } from '../db/schema.js';
import { isTaskType, type TaskPriority } from '../../domain/task/Task.js';
import { parseTaskRecurrence, serializeTaskRecurrence } from '../../domain/task/TaskRecurrence.js';
import type { WorkspaceTaskTemplate } from '../../domain/task/WorkspaceTaskTemplate.js';
import type {
  CreateWorkspaceTaskTemplateInput,
  WorkspaceTaskTemplateRepository,
} from '../../application/task/WorkspaceTaskTemplateRepository.js';

function toDomain(row: WorkspaceTaskTemplateRow): WorkspaceTaskTemplate {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    description: row.description,
    priority: row.priority !== null && row.priority !== undefined ? (row.priority as TaskPriority) : null,
    taskType: isTaskType(row.taskType) ? row.taskType : null,
    recurrence: parseTaskRecurrence(row.recurrence),
    createdBy: row.createdBy ?? null,
    createdAt: row.createdAt,
  };
}

export class DrizzleWorkspaceTaskTemplateRepository implements WorkspaceTaskTemplateRepository {
  constructor(private readonly db: Database) {}

  async listByWorkspace(workspaceId: string): Promise<WorkspaceTaskTemplate[]> {
    const rows = await this.db
      .select()
      .from(workspaceTaskTemplates)
      .where(eq(workspaceTaskTemplates.workspaceId, workspaceId))
      .orderBy(desc(workspaceTaskTemplates.createdAt), desc(workspaceTaskTemplates.id));
    return rows.map(toDomain);
  }

  async getById(id: string): Promise<WorkspaceTaskTemplate | null> {
    const rows = await this.db
      .select()
      .from(workspaceTaskTemplates)
      .where(eq(workspaceTaskTemplates.id, id))
      .limit(1);
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async create(input: CreateWorkspaceTaskTemplateInput): Promise<WorkspaceTaskTemplate> {
    await this.db.insert(workspaceTaskTemplates).values({
      id: input.id,
      workspaceId: input.workspaceId,
      name: input.name,
      description: input.description,
      priority: input.priority,
      taskType: input.taskType,
      recurrence: serializeTaskRecurrence(input.recurrence),
      createdBy: input.createdBy,
    });
    const created = await this.getById(input.id);
    if (!created) throw new Error('Failed to read back workspace task template after insert');
    return created;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(workspaceTaskTemplates).where(eq(workspaceTaskTemplates.id, id));
  }
}
