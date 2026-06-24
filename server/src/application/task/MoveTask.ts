import { TaskNotFoundError } from '../../domain/task/errors.js';
import { TASK_STATUSES, type Task, type TaskStatus } from '../../domain/task/Task.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { TaskRepository } from './TaskRepository.js';
import type { TaskDelegationRepository } from './TaskDelegationRepository.js';
import { requireTaskModifyAccess } from './taskAuthorization.js';
import type { ActivityRecorder } from '../activity/ActivityRecorder.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly tasks: TaskRepository;
  readonly delegations: TaskDelegationRepository;
  // Лента действий (best-effort). Опционально.
  readonly activityRecorder?: ActivityRecorder;
};

// Клиент сообщает соседей в целевой колонке — сервер сам считает midpoint position.
// Это надёжнее чем доверять клиенту произвольное число (нет шанса dimension-collision при collab).
export type MoveTaskCommand = {
  readonly projectId: string;
  readonly ownerUserId: string;
  readonly taskId: string;
  readonly targetStatus: TaskStatus;
  // ID карточки, которая должна оказаться ВЫШЕ перенесённой; null = вставить наверх.
  readonly beforeTaskId: string | null;
  // ID карточки, которая должна оказаться НИЖЕ перенесённой; null = вставить вниз.
  readonly afterTaskId: string | null;
  // Снятие галочки «выполнено»: вернуть задачу в статус, который был до 'done'
  // (status_before_done), а не в переданный targetStatus. Сервер сам резолвит цель —
  // не доверяем клиентскому (возможно устаревшему) чтению. См. db/055.
  readonly restore?: boolean;
};

const POSITION_STEP = 1024;

// При снятии галочки восстанавливаем ТОЧНЫЙ прежний статус (требование «запомнить
// прежний статус»). Фолбэк 'todo' — только если снапшота нет (null/legacy) или он
// невалиден. 'done' в снапшот не попадает (guard при захвате в execute).
function restoreTargetFrom(prev: TaskStatus | null): TaskStatus {
  if (prev && prev !== 'done' && TASK_STATUSES.includes(prev)) return prev;
  return 'todo';
}

export class MoveTask {
  constructor(private readonly deps: Deps) {}

  async execute(input: MoveTaskCommand): Promise<Task> {
    await requireTaskModifyAccess(
      this.deps,
      input.projectId,
      input.taskId,
      input.ownerUserId,
      'move_task',
    );

    const task = await this.deps.tasks.getById(input.taskId);
    if (!task || task.projectId !== input.projectId) throw new TaskNotFoundError(input.taskId);

    // Резолвим фактический целевой статус + патч снапшота status_before_done.
    // undefined-патч = поле не трогаем.
    let targetStatus = input.targetStatus;
    let statusBeforeDonePatch: TaskStatus | null | undefined;

    if (input.restore && task.status === 'done') {
      // Снятие галочки: восстанавливаем прежний статус, чистим снапшот.
      targetStatus = restoreTargetFrom(task.statusBeforeDone);
      statusBeforeDonePatch = null;
    } else if (targetStatus === 'done' && task.status !== 'done') {
      // Переход в done: запоминаем текущий статус (guard !=='done' => не запишем 'done').
      statusBeforeDonePatch = task.status;
    } else if (task.status === 'done' && targetStatus !== 'done') {
      // Явный уход из done (drag в другую колонку): снапшот больше не нужен.
      statusBeforeDonePatch = null;
    }

    const beforePos = await this.resolvePosition(input.beforeTaskId, input.projectId);
    const afterPos = await this.resolvePosition(input.afterTaskId, input.projectId);

    const newPosition = await this.computePosition(
      beforePos,
      afterPos,
      input.projectId,
      targetStatus,
    );

    const updated = await this.deps.tasks.update(input.taskId, {
      status: targetStatus,
      position: newPosition,
      ...(statusBeforeDonePatch !== undefined
        ? { statusBeforeDone: statusBeforeDonePatch }
        : {}),
    });
    if (!updated) throw new TaskNotFoundError(input.taskId);

    // Лента действий: только при реальной смене статуса (не при reorder внутри колонки).
    if (updated.status !== task.status) {
      void this.deps.activityRecorder?.record({
        projectId: input.projectId,
        actorUserId: input.ownerUserId,
        kind: 'task_status_changed',
        payload: {
          taskId: task.id,
          taskExcerpt: task.description.slice(0, 120),
          oldStatus: task.status,
          newStatus: updated.status,
        },
      });
    }
    return updated;
  }

  private async resolvePosition(taskId: string | null, projectId: string): Promise<number | null> {
    if (!taskId) return null;
    const t = await this.deps.tasks.getById(taskId);
    if (!t || t.projectId !== projectId) return null;
    return t.position;
  }

  private async computePosition(
    before: number | null,
    after: number | null,
    projectId: string,
    status: TaskStatus,
  ): Promise<number> {
    // Обе границы заданы → берём середину.
    if (before !== null && after !== null) return (before + after) / 2;
    // Только верхний сосед → кладём ниже него.
    if (before !== null) return before + POSITION_STEP;
    // Только нижний сосед → кладём выше него.
    if (after !== null) return after - POSITION_STEP;
    // Соседей нет — пустая колонка. Спросим bounds (на случай если карточку сами же двигаем).
    const bounds = await this.deps.tasks.getPositionBounds(projectId, status);
    return bounds ? bounds.max + POSITION_STEP : POSITION_STEP;
  }
}
