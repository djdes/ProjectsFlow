import { aliasedTable, and, asc, desc, eq, inArray, max, min, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import {
  taskDelegations,
  tasks,
  users,
  taskComments,
  taskAttachments,
  taskCommits,
  taskVersions,
  taskProgressEvents,
  liveSessions,
  recentTaskViews,
  telegramTaskMessages,
  emailActionTokens,
  type TaskRow,
} from '../db/schema.js';
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
import type { TaskVersionRecorder } from '../../application/task/TaskVersionRecorder.js';
import { activeTasks, taskDeleted } from './taskSoftDelete.js';

// Row shape с заджойненным display_name запросившего отмену Ralph.
type TaskRowJoined = Omit<TaskRow, 'deletedAt' | 'deletedBy'> & {
  deletedAt?: Date | null;
  deletedBy?: string | null;
} & {
  cancelByDisplayName: string | null;
  assigneeDisplayName: string | null;
  assigneeAvatarUrl: string | null;
  creatorDisplayName: string | null;
  creatorAvatarUrl: string | null;
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
    createdBy: row.createdBy ?? null,
    creator: row.createdBy
      ? {
          userId: row.createdBy,
          displayName: row.creatorDisplayName ?? 'Удалённый пользователь',
          avatarUrl: row.creatorAvatarUrl ?? null,
        }
      : null,
    assignee: {
      userId: row.assigneeUserId,
      displayName: row.assigneeDisplayName ?? 'Удалённый пользователь',
      avatarUrl: row.assigneeAvatarUrl ?? null,
    },
    description: row.description ?? null,
    icon: row.icon ?? null,
    cover: row.cover ?? null,
    coverPosition: row.coverPosition ?? 50,
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
    startDate: row.startDate ?? null,
    parentTaskId: row.parentTaskId ?? null,
    // tinyint 1..4 — на проводе number. Cast в TaskPriority безопасен (валидация в zod
    // на write-path; на read возможно увидим число вне диапазона если кто-то сделал
    // ручной UPDATE — но это edge-case).
    priority: row.priority !== null && row.priority !== undefined
      ? (row.priority as TaskPriority)
      : null,
    deletedAt: row.deletedAt ?? null,
    deletedBy: row.deletedBy ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DrizzleTaskRepository implements TaskRepository {
  constructor(
    private readonly db: Database,
    private readonly history?: TaskVersionRecorder,
  ) {}

  // Базовый SELECT с LEFT JOIN users для display name запросившего cancel.
  // LEFT JOIN — потому что флаг чаще NULL (стандартный кейс).
  private baseSelect() {
    const assigneeUser = aliasedTable(users, 'task_assignee_user');
    const creatorUser = aliasedTable(users, 'task_creator_user');
    return this.db
      .select({
        id: tasks.id,
        projectId: tasks.projectId,
        // ВАЖНО: без этой строки row.createdBy = undefined → toTask даёт null → воркер метерит
        // на диспетчера, а не на создателя задачи (баг: `as TaskRowJoined` прятал это от tsc).
        createdBy: tasks.createdBy,
        assigneeUserId: tasks.assigneeUserId,
        assigneeDisplayName: assigneeUser.displayName,
        assigneeAvatarUrl: assigneeUser.avatarUrl,
        creatorDisplayName: creatorUser.displayName,
        creatorAvatarUrl: creatorUser.avatarUrl,
        description: tasks.description,
        icon: tasks.icon,
        cover: tasks.cover,
        coverPosition: tasks.coverPosition,
        status: tasks.status,
        statusBeforeDone: tasks.statusBeforeDone,
        position: tasks.position,
        ralphMode: tasks.ralphMode,
        ralphCancelRequestedAt: tasks.ralphCancelRequestedAt,
        ralphCancelRequestedBy: tasks.ralphCancelRequestedBy,
        deadline: tasks.deadline,
        startDate: tasks.startDate,
        parentTaskId: tasks.parentTaskId,
        priority: tasks.priority,
        deletedAt: tasks.deletedAt,
        deletedBy: tasks.deletedBy,
        createdAt: tasks.createdAt,
        updatedAt: tasks.updatedAt,
        cancelByDisplayName: users.displayName,
      })
      .from(tasks)
      .leftJoin(users, eq(users.id, tasks.ralphCancelRequestedBy))
      .leftJoin(assigneeUser, eq(assigneeUser.id, tasks.assigneeUserId))
      .leftJoin(creatorUser, eq(creatorUser.id, tasks.createdBy));
  }

  async listByProject(projectId: string): Promise<Task[]> {
    const rows = await this.baseSelect()
      .where(activeTasks(eq(tasks.projectId, projectId)))
      .orderBy(asc(tasks.status), asc(tasks.position), asc(tasks.id));
    return rows.map((r) => toTask(r as TaskRowJoined));
  }

  async listByIds(taskIds: readonly string[]): Promise<Task[]> {
    if (taskIds.length === 0) return [];
    const rows = await this.baseSelect().where(activeTasks(inArray(tasks.id, [...taskIds])));
    return rows.map((r) => toTask(r as TaskRowJoined));
  }

  async listAssignedTo(userId: string): Promise<Task[]> {
    const rows = await this.baseSelect()
      .where(activeTasks(eq(tasks.assigneeUserId, userId)))
      .orderBy(asc(tasks.status), asc(tasks.position), asc(tasks.id));
    return rows.map((r) => toTask(r as TaskRowJoined));
  }

  async getById(taskId: string): Promise<Task | null> {
    const rows = await this.baseSelect().where(activeTasks(eq(tasks.id, taskId))).limit(1);
    return rows[0] ? toTask(rows[0] as TaskRowJoined) : null;
  }

  async getByIdIncludingDeleted(taskId: string): Promise<Task | null> {
    const rows = await this.baseSelect().where(eq(tasks.id, taskId)).limit(1);
    return rows[0] ? toTask(rows[0] as TaskRowJoined) : null;
  }

  async listTrashedByProject(projectId: string): Promise<Task[]> {
    const rows = await this.baseSelect()
      .where(and(eq(tasks.projectId, projectId), taskDeleted()))
      .orderBy(desc(tasks.deletedAt), asc(tasks.id));
    return rows.map((r) => toTask(r as TaskRowJoined));
  }

  async create(input: CreateTaskInput): Promise<Task> {
    await this.db.insert(tasks).values({
      id: input.id,
      projectId: input.projectId,
      createdBy: input.createdBy,
      assigneeUserId: input.assigneeUserId,
      description: input.description,
      icon: input.icon ?? null,
      cover: input.cover ?? null,
      coverPosition: input.coverPosition ?? 50,
      status: input.status,
      position: input.position,
      // Не выставляем если undefined — пусть отработает SQL DEFAULT.
      ...(input.ralphMode !== undefined ? { ralphMode: input.ralphMode } : {}),
      ...(input.deadline !== undefined ? { deadline: input.deadline } : {}),
      ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
      ...(input.parentTaskId !== undefined ? { parentTaskId: input.parentTaskId } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
    });
    const created = await this.getById(input.id);
    if (!created) throw new Error('Failed to read back task after insert');
    await this.history?.record(created, input.actorUserId ?? input.createdBy);
    return created;
  }

  async update(
    taskId: string,
    patch: UpdateTaskPatch,
    actorUserId: string | null = null,
  ): Promise<Task | null> {
    const before = this.history ? await this.getById(taskId) : null;
    const set: Partial<
      Pick<
        TaskRow,
        | 'description'
        | 'assigneeUserId'
        | 'icon'
        | 'cover'
        | 'coverPosition'
        | 'status'
        | 'statusBeforeDone'
        | 'position'
        | 'ralphMode'
        | 'deadline'
        | 'startDate'
        | 'parentTaskId'
        | 'priority'
      >
    > = {};
    if (patch.assigneeUserId !== undefined) set.assigneeUserId = patch.assigneeUserId;
    if (patch.description !== undefined) set.description = patch.description;
    if (patch.icon !== undefined) set.icon = patch.icon;
    if (patch.cover !== undefined) set.cover = patch.cover;
    if (patch.coverPosition !== undefined) set.coverPosition = patch.coverPosition;
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.statusBeforeDone !== undefined) set.statusBeforeDone = patch.statusBeforeDone;
    if (patch.position !== undefined) set.position = patch.position;
    if (patch.ralphMode !== undefined) set.ralphMode = patch.ralphMode;
    if (patch.deadline !== undefined) set.deadline = patch.deadline;
    if (patch.startDate !== undefined) set.startDate = patch.startDate;
    if (patch.parentTaskId !== undefined) set.parentTaskId = patch.parentTaskId;
    if (patch.priority !== undefined) set.priority = patch.priority;

    if (Object.keys(set).length > 0) {
      await this.db.update(tasks).set(set).where(activeTasks(eq(tasks.id, taskId)));
    }
    const updated = await this.getById(taskId);
    if (updated && before) await this.history?.record(updated, actorUserId, before);
    return updated;
  }

  async softDelete(taskId: string, deletedByUserId: string | null): Promise<boolean> {
    // Идемпотентно: повторный клик «Удалить» (двойной клик / ретрай запроса) не должен
    // переписывать deleted_at — иначе окно Undo и порядок в корзине уезжают.
    // Подзадачи НЕ отвязываем (в отличие от физического deleteWithChildren): parent_task_id
    // должен пережить откат, иначе восстановление вернёт задачу с тем же id, но без детей.
    const result = await this.db
      .update(tasks)
      .set({ deletedAt: sql`CURRENT_TIMESTAMP`, deletedBy: deletedByUserId })
      .where(activeTasks(eq(tasks.id, taskId)));
    const affected = (result as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 0;
    return affected > 0;
  }

  async restore(taskId: string): Promise<Task | null> {
    // Снимаем метку и читаем задачу обратно — тот же id, те же комментарии/версии/коммиты.
    await this.db
      .update(tasks)
      .set({ deletedAt: null, deletedBy: null })
      .where(and(eq(tasks.id, taskId), taskDeleted()));
    return this.getById(taskId);
  }

  async delete(taskId: string): Promise<boolean> {
    const result = await this.db.delete(tasks).where(eq(tasks.id, taskId));
    const affected = (result as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 0;
    return affected > 0;
  }

  async deleteWithChildren(taskId: string): Promise<boolean> {
    let existed = false;
    await this.db.transaction(async (tx) => {
      // Child-таблицы задачи (FK на схеме нет — чистим вручную). Порядок не важен.
      await tx.delete(taskComments).where(eq(taskComments.taskId, taskId));
      await tx.delete(taskAttachments).where(eq(taskAttachments.taskId, taskId));
      await tx.delete(taskCommits).where(eq(taskCommits.taskId, taskId));
      await tx.delete(taskVersions).where(eq(taskVersions.taskId, taskId));
      await tx.delete(taskDelegations).where(eq(taskDelegations.taskId, taskId));
      await tx.delete(taskProgressEvents).where(eq(taskProgressEvents.taskId, taskId));
      await tx.delete(liveSessions).where(eq(liveSessions.taskId, taskId));
      await tx.delete(recentTaskViews).where(eq(recentTaskViews.taskId, taskId));
      await tx.delete(telegramTaskMessages).where(eq(telegramTaskMessages.taskId, taskId));
      await tx.delete(emailActionTokens).where(eq(emailActionTokens.taskId, taskId));
      // Подзадачи не удаляем — отвязываем на верхний уровень (db/107).
      await tx.update(tasks).set({ parentTaskId: null }).where(eq(tasks.parentTaskId, taskId));
      const result = await tx.delete(tasks).where(eq(tasks.id, taskId));
      const affected = (result as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 0;
      existed = affected > 0;
    });
    return existed;
  }

  async getPositionBounds(
    projectId: string,
    status: TaskStatus,
  ): Promise<{ min: number; max: number } | null> {
    const rows = await this.db
      .select({ minPos: min(tasks.position), maxPos: max(tasks.position) })
      .from(tasks)
      .where(activeTasks(eq(tasks.projectId, projectId), eq(tasks.status, status)));
    const row = rows[0];
    if (!row || row.minPos === null || row.maxPos === null) return null;
    return { min: Number(row.minPos), max: Number(row.maxPos) };
  }

  async requestRalphCancel(taskId: string, userId: string): Promise<Task | null> {
    const before = this.history ? await this.getById(taskId) : null;
    // Идемпотентно — пишем только если ralph_cancel_requested_at IS NULL.
    // Это гарантирует что повторный POST не «обновляет» timestamp (важно для UI который
    // показывает «N сек назад»).
    await this.db
      .update(tasks)
      .set({
        ralphCancelRequestedAt: sql`CURRENT_TIMESTAMP`,
        ralphCancelRequestedBy: userId,
      })
      .where(activeTasks(eq(tasks.id, taskId), sql`${tasks.ralphCancelRequestedAt} IS NULL`));
    const updated = await this.getById(taskId);
    if (updated && before) await this.history?.record(updated, userId, before);
    return updated;
  }

  async clearRalphCancel(
    taskId: string,
    actorUserId: string | null = null,
  ): Promise<Task | null> {
    const before = this.history ? await this.getById(taskId) : null;
    await this.db
      .update(tasks)
      .set({ ralphCancelRequestedAt: null, ralphCancelRequestedBy: null })
      .where(activeTasks(eq(tasks.id, taskId)));
    const updated = await this.getById(taskId);
    if (updated && before) await this.history?.record(updated, actorUserId, before);
    return updated;
  }

  async rebalanceColumn(
    projectId: string,
    status: TaskStatus,
    taskId: string,
  ): Promise<number | null> {
    const STEP = 1024;
    let resultPos: number | null = null;
    await this.db.transaction(async (tx) => {
      const rows = await tx
        .select({ id: tasks.id })
        .from(tasks)
        .where(activeTasks(eq(tasks.projectId, projectId), eq(tasks.status, status)))
        .orderBy(asc(tasks.position), asc(tasks.id));
      let pos = STEP;
      for (const r of rows) {
        await tx.update(tasks).set({ position: pos }).where(eq(tasks.id, r.id));
        if (r.id === taskId) resultPos = pos;
        pos += STEP;
      }
    });
    return resultPos;
  }

  async moveToProject(
    taskId: string,
    targetProjectId: string,
    assigneeUserId: string,
    actorUserId: string | null = null,
  ): Promise<Task | null> {
    const before = this.history ? await this.getById(taskId) : null;
    // Снимок status_before_done относился к колонкам старого проекта — чистим при переносе.
    // Вместе с задачей АТОМАРНО перевешиваем task-scoped строки с денормализованным
    // project_id (версии, лента прогресса, live-сессии, «Недавнее»): иначе (а) чтение
    // live/версий в новом проекте 404-ит (гейты сверяют session.projectId с URL), (б)
    // участники СТАРОГО проекта продолжают читать историю уехавшей задачи, (в) удаление
    // опустевшего старого проекта (deleteCascade чистит эти таблицы по project_id)
    // молча стирает историю живой задачи.
    await this.db.transaction(async (tx) => {
      await tx
        .update(tasks)
        .set({ projectId: targetProjectId, assigneeUserId, statusBeforeDone: null })
        .where(activeTasks(eq(tasks.id, taskId)));
      await tx
        .update(taskVersions)
        .set({ projectId: targetProjectId })
        .where(eq(taskVersions.taskId, taskId));
      await tx
        .update(taskProgressEvents)
        .set({ projectId: targetProjectId })
        .where(eq(taskProgressEvents.taskId, taskId));
      await tx
        .update(liveSessions)
        .set({ projectId: targetProjectId })
        .where(eq(liveSessions.taskId, taskId));
      await tx
        .update(recentTaskViews)
        .set({ projectId: targetProjectId })
        .where(eq(recentTaskViews.taskId, taskId));
    });
    const updated = await this.getById(taskId);
    if (updated && before) await this.history?.record(updated, actorUserId, before);
    return updated;
  }
}
