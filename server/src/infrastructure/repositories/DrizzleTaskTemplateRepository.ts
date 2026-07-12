import { asc, eq } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { taskTemplates, type TaskTemplateRow } from '../db/schema.js';
import type { TaskTemplate } from '../../domain/task/TaskTemplate.js';
import type { TaskPriority, TaskStatus } from '../../domain/task/Task.js';
import type {
  CreateTaskTemplateInput,
  TaskTemplateRepository,
} from '../../application/task/TaskTemplateRepository.js';

function toDomain(row: TaskTemplateRow): TaskTemplate {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    description: row.description,
    status: row.status as TaskStatus,
    priority:
      row.priority !== null && row.priority !== undefined ? (row.priority as TaskPriority) : null,
    icon: row.icon ?? null,
    createdAt: row.createdAt,
  };
}

export class DrizzleTaskTemplateRepository implements TaskTemplateRepository {
  constructor(private readonly db: Database) {}

  async listForProject(projectId: string): Promise<TaskTemplate[]> {
    const rows = await this.db
      .select()
      .from(taskTemplates)
      .where(eq(taskTemplates.projectId, projectId))
      .orderBy(asc(taskTemplates.createdAt));
    return rows.map(toDomain);
  }

  async getById(id: string): Promise<TaskTemplate | null> {
    const rows = await this.db
      .select()
      .from(taskTemplates)
      .where(eq(taskTemplates.id, id))
      .limit(1);
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async create(input: CreateTaskTemplateInput): Promise<TaskTemplate> {
    await this.db.insert(taskTemplates).values({
      id: input.id,
      projectId: input.projectId,
      name: input.name,
      description: input.description,
      status: input.status,
      priority: input.priority,
      icon: input.icon,
      createdBy: input.createdBy,
    });
    const created = await this.getById(input.id);
    if (!created) throw new Error('Failed to read back task template after insert');
    return created;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(taskTemplates).where(eq(taskTemplates.id, id));
  }
}
