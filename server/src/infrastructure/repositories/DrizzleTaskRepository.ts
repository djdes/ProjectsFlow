import { and, asc, eq, max, min } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { tasks, type TaskRow } from '../db/schema.js';
import type { Task, TaskStatus } from '../../domain/task/Task.js';
import type {
  CreateTaskInput,
  TaskRepository,
  UpdateTaskPatch,
} from '../../application/task/TaskRepository.js';

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    projectId: row.projectId,
    description: row.description ?? null,
    status: row.status as TaskStatus,
    position: row.position,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DrizzleTaskRepository implements TaskRepository {
  constructor(private readonly db: Database) {}

  async listByProject(projectId: string): Promise<Task[]> {
    const rows = await this.db
      .select()
      .from(tasks)
      .where(eq(tasks.projectId, projectId))
      .orderBy(asc(tasks.status), asc(tasks.position), asc(tasks.id));
    return rows.map(toTask);
  }

  async getById(taskId: string): Promise<Task | null> {
    const rows = await this.db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
    return rows[0] ? toTask(rows[0]) : null;
  }

  async create(input: CreateTaskInput): Promise<Task> {
    await this.db.insert(tasks).values({
      id: input.id,
      projectId: input.projectId,
      description: input.description,
      status: input.status,
      position: input.position,
    });
    const created = await this.getById(input.id);
    if (!created) throw new Error('Failed to read back task after insert');
    return created;
  }

  async update(taskId: string, patch: UpdateTaskPatch): Promise<Task | null> {
    const set: Partial<Pick<TaskRow, 'description' | 'status' | 'position'>> = {};
    if (patch.description !== undefined) set.description = patch.description;
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.position !== undefined) set.position = patch.position;

    if (Object.keys(set).length > 0) {
      await this.db.update(tasks).set(set).where(eq(tasks.id, taskId));
    }
    return this.getById(taskId);
  }

  async delete(taskId: string): Promise<boolean> {
    const result = await this.db.delete(tasks).where(eq(tasks.id, taskId));
    const affected = (result as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 0;
    return affected > 0;
  }

  async getPositionBounds(
    projectId: string,
    status: TaskStatus,
  ): Promise<{ min: number; max: number } | null> {
    const rows = await this.db
      .select({ minPos: min(tasks.position), maxPos: max(tasks.position) })
      .from(tasks)
      .where(and(eq(tasks.projectId, projectId), eq(tasks.status, status)));
    const row = rows[0];
    if (!row || row.minPos === null || row.maxPos === null) return null;
    return { min: Number(row.minPos), max: Number(row.maxPos) };
  }

  async setDelegatedToAgent(taskId: string, value: boolean): Promise<void> {
    await this.db
      .update(tasks)
      .set({ delegatedToAgent: value })
      .where(eq(tasks.id, taskId));
  }
}
