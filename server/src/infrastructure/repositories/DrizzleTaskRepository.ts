import { and, asc, eq, max, min, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { tasks, users, type TaskRow } from '../db/schema.js';
import type { RalphMode, Task, TaskStatus } from '../../domain/task/Task.js';
import type {
  CreateTaskInput,
  TaskRepository,
  UpdateTaskPatch,
} from '../../application/task/TaskRepository.js';

// Row shape с заджойненным display_name запросившего отмену Ralph.
type TaskRowJoined = TaskRow & {
  cancelByDisplayName: string | null;
};

function toTask(row: TaskRowJoined): Task {
  return {
    id: row.id,
    projectId: row.projectId,
    description: row.description ?? null,
    status: row.status as TaskStatus,
    position: row.position,
    delegatedToAgent: row.delegatedToAgent,
    // VARCHAR в БД, cast в domain enum. Дефолт 'normal' — соответствует SQL DEFAULT,
    // защита от unexpected значений (если миграция/ручной UPDATE проставит чушь).
    ralphMode: (row.ralphMode as RalphMode) ?? 'normal',
    ralphCancelRequestedAt: row.ralphCancelRequestedAt ?? null,
    ralphCancelRequestedBy: row.ralphCancelRequestedBy ?? null,
    ralphCancelRequestedByDisplayName: row.cancelByDisplayName ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DrizzleTaskRepository implements TaskRepository {
  constructor(private readonly db: Database) {}

  // Базовый SELECT с LEFT JOIN users для display name запросившего cancel.
  // LEFT JOIN — потому что флаг чаще NULL (стандартный кейс).
  private baseSelect() {
    return this.db
      .select({
        id: tasks.id,
        projectId: tasks.projectId,
        description: tasks.description,
        status: tasks.status,
        position: tasks.position,
        delegatedToAgent: tasks.delegatedToAgent,
        ralphMode: tasks.ralphMode,
        ralphCancelRequestedAt: tasks.ralphCancelRequestedAt,
        ralphCancelRequestedBy: tasks.ralphCancelRequestedBy,
        createdAt: tasks.createdAt,
        updatedAt: tasks.updatedAt,
        cancelByDisplayName: users.displayName,
      })
      .from(tasks)
      .leftJoin(users, eq(users.id, tasks.ralphCancelRequestedBy));
  }

  async listByProject(projectId: string): Promise<Task[]> {
    const rows = await this.baseSelect()
      .where(eq(tasks.projectId, projectId))
      .orderBy(asc(tasks.status), asc(tasks.position), asc(tasks.id));
    return rows.map((r) => toTask(r as TaskRowJoined));
  }

  async getById(taskId: string): Promise<Task | null> {
    const rows = await this.baseSelect().where(eq(tasks.id, taskId)).limit(1);
    return rows[0] ? toTask(rows[0] as TaskRowJoined) : null;
  }

  async create(input: CreateTaskInput): Promise<Task> {
    await this.db.insert(tasks).values({
      id: input.id,
      projectId: input.projectId,
      description: input.description,
      status: input.status,
      position: input.position,
      // Не выставляем если undefined — пусть отработает SQL DEFAULT 'normal'.
      ...(input.ralphMode !== undefined ? { ralphMode: input.ralphMode } : {}),
    });
    const created = await this.getById(input.id);
    if (!created) throw new Error('Failed to read back task after insert');
    return created;
  }

  async update(taskId: string, patch: UpdateTaskPatch): Promise<Task | null> {
    const set: Partial<Pick<TaskRow, 'description' | 'status' | 'position' | 'ralphMode'>> = {};
    if (patch.description !== undefined) set.description = patch.description;
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.position !== undefined) set.position = patch.position;
    if (patch.ralphMode !== undefined) set.ralphMode = patch.ralphMode;

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

  async requestRalphCancel(taskId: string, userId: string): Promise<Task | null> {
    // Идемпотентно — пишем только если ralph_cancel_requested_at IS NULL.
    // Это гарантирует что повторный POST не «обновляет» timestamp (важно для UI который
    // показывает «N сек назад»).
    await this.db
      .update(tasks)
      .set({
        ralphCancelRequestedAt: sql`CURRENT_TIMESTAMP`,
        ralphCancelRequestedBy: userId,
      })
      .where(and(eq(tasks.id, taskId), sql`${tasks.ralphCancelRequestedAt} IS NULL`));
    return this.getById(taskId);
  }

  async clearRalphCancel(taskId: string): Promise<Task | null> {
    await this.db
      .update(tasks)
      .set({ ralphCancelRequestedAt: null, ralphCancelRequestedBy: null })
      .where(eq(tasks.id, taskId));
    return this.getById(taskId);
  }
}
