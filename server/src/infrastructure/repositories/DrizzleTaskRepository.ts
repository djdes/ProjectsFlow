import { and, asc, eq, inArray, max, min, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { projects, taskDelegations, tasks, users, type TaskRow } from '../db/schema.js';
import {
  TASK_STATUSES,
  type RalphMode,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from '../../domain/task/Task.js';
import type {
  CreateTaskInput,
  TaskRepository,
  UpdateTaskPatch,
} from '../../application/task/TaskRepository.js';

// Row shape с заджойненным display_name запросившего отмену Ralph.
type TaskRowJoined = TaskRow & {
  cancelByDisplayName: string | null;
};

// status_before_done — VARCHAR в БД, поэтому валидируем против enum (а не голый cast):
// невалидное/legacy значение читаем как null (фолбэк восстановления — 'todo').
function asTaskStatus(v: string | null | undefined): TaskStatus | null {
  return v && (TASK_STATUSES as readonly string[]).includes(v) ? (v as TaskStatus) : null;
}

function toTask(row: TaskRowJoined): Task {
  return {
    id: row.id,
    projectId: row.projectId,
    description: row.description ?? null,
    status: row.status as TaskStatus,
    statusBeforeDone: asTaskStatus(row.statusBeforeDone),
    position: row.position,
    // VARCHAR в БД, cast в domain enum. Дефолт 'normal' — соответствует SQL DEFAULT,
    // защита от unexpected значений (если миграция/ручной UPDATE проставит чушь).
    ralphMode: (row.ralphMode as RalphMode) ?? 'normal',
    ralphCancelRequestedAt: row.ralphCancelRequestedAt ?? null,
    ralphCancelRequestedBy: row.ralphCancelRequestedBy ?? null,
    ralphCancelRequestedByDisplayName: row.cancelByDisplayName ?? null,
    // Drizzle с mysql2 возвращает DATE-колонку как string 'YYYY-MM-DD' (см. drizzle docs).
    // Cast не нужен — TypeScript $inferSelect уже даёт string | null.
    deadline: row.deadline ?? null,
    // tinyint 1..4 — на проводе number. Cast в TaskPriority безопасен (валидация в zod
    // на write-path; на read возможно увидим число вне диапазона если кто-то сделал
    // ручной UPDATE — но это edge-case).
    priority: row.priority !== null && row.priority !== undefined
      ? (row.priority as TaskPriority)
      : null,
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
        statusBeforeDone: tasks.statusBeforeDone,
        position: tasks.position,
        ralphMode: tasks.ralphMode,
        ralphCancelRequestedAt: tasks.ralphCancelRequestedAt,
        ralphCancelRequestedBy: tasks.ralphCancelRequestedBy,
        deadline: tasks.deadline,
        priority: tasks.priority,
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

  async listByIds(taskIds: readonly string[]): Promise<Task[]> {
    if (taskIds.length === 0) return [];
    const rows = await this.baseSelect().where(inArray(tasks.id, [...taskIds]));
    return rows.map((r) => toTask(r as TaskRowJoined));
  }

  async listAcceptedDelegatedTo(userId: string): Promise<Task[]> {
    // JOIN task_delegations + projects: фильтр accepted-делегации к userId на
    // задачах, которые лежат в inbox-проектах (на всякий — out-of-scope:
    // делегирование в проектные задачи мы не поддерживаем).
    const rows = await this.baseSelect()
      .innerJoin(taskDelegations, eq(taskDelegations.taskId, tasks.id))
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(
        and(
          eq(taskDelegations.delegateUserId, userId),
          eq(taskDelegations.status, 'accepted'),
          eq(projects.isInbox, true),
        ),
      )
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
      // Не выставляем если undefined — пусть отработает SQL DEFAULT.
      ...(input.ralphMode !== undefined ? { ralphMode: input.ralphMode } : {}),
      ...(input.deadline !== undefined ? { deadline: input.deadline } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
    });
    const created = await this.getById(input.id);
    if (!created) throw new Error('Failed to read back task after insert');
    return created;
  }

  async update(taskId: string, patch: UpdateTaskPatch): Promise<Task | null> {
    const set: Partial<
      Pick<
        TaskRow,
        | 'description'
        | 'status'
        | 'statusBeforeDone'
        | 'position'
        | 'ralphMode'
        | 'deadline'
        | 'priority'
      >
    > = {};
    if (patch.description !== undefined) set.description = patch.description;
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.statusBeforeDone !== undefined) set.statusBeforeDone = patch.statusBeforeDone;
    if (patch.position !== undefined) set.position = patch.position;
    if (patch.ralphMode !== undefined) set.ralphMode = patch.ralphMode;
    if (patch.deadline !== undefined) set.deadline = patch.deadline;
    if (patch.priority !== undefined) set.priority = patch.priority;

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

  async moveToProject(taskId: string, targetProjectId: string): Promise<Task | null> {
    // Снимок status_before_done относился к колонкам старого проекта — чистим при переносе.
    await this.db
      .update(tasks)
      .set({ projectId: targetProjectId, statusBeforeDone: null })
      .where(eq(tasks.id, taskId));
    return this.getById(taskId);
  }
}
