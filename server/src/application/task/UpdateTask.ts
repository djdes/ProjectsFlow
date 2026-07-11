import { TaskDescriptionEmptyError, TaskNotFoundError } from '../../domain/task/errors.js';
import type { RalphMode, Task, TaskPriority } from '../../domain/task/Task.js';
import type { ActivityFieldChange } from '../../domain/activity/ActivityEvent.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { TaskRepository, UpdateTaskPatch } from './TaskRepository.js';
import type { TaskDelegationRepository } from './TaskDelegationRepository.js';
import type { ActivityRecorder } from '../activity/ActivityRecorder.js';
import type { TaskVersionRecorder } from './TaskVersionRecorder.js';
import { requireTaskModifyAccess } from './taskAuthorization.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly tasks: TaskRepository;
  readonly delegations: TaskDelegationRepository;
  // Логируем правки в ленту изменений (best-effort; опционально для обратной совместимости).
  readonly activity?: ActivityRecorder;
  // Снимок версии после правки (для окна версий + restore).
  readonly versions?: TaskVersionRecorder;
};

// Первая строка описания (заголовок задачи) — короткая выжимка для ленты.
function taskTitle(description: string | null | undefined): string {
  return (description ?? '').split('\n')[0]!.trim().slice(0, 80);
}

export type UpdateTaskCommand = {
  readonly projectId: string;
  readonly ownerUserId: string;
  readonly taskId: string;
  readonly description: string | undefined;
  // null = очистить иконку; undefined = не менять. См. db/093.
  readonly icon?: string | null;
  // null = очистить обложку; undefined = не менять. См. db/094.
  readonly cover?: string | null;
  // Вертикальное положение фокуса обложки (0..100); undefined = не менять. См. db/094.
  readonly coverPosition?: number;
  // Сменить режим Ralph можно в любой момент — диспетчер на следующем тике увидит.
  readonly ralphMode?: RalphMode;
  // null = очистить deadline; undefined = не менять.
  readonly deadline?: string | null;
  // null = очистить дату начала; undefined = не менять.
  readonly startDate?: string | null;
  // null = убрать приоритет; undefined = не менять.
  readonly priority?: TaskPriority | null;
};

export class UpdateTask {
  constructor(private readonly deps: Deps) {}

  async execute(input: UpdateTaskCommand): Promise<Task> {
    await requireTaskModifyAccess(
      this.deps,
      input.projectId,
      input.taskId,
      input.ownerUserId,
      'update_task',
    );

    const existing = await this.deps.tasks.getById(input.taskId);
    if (!existing || existing.projectId !== input.projectId) throw new TaskNotFoundError(input.taskId);

    const patch: { -readonly [K in keyof UpdateTaskPatch]: UpdateTaskPatch[K] } = {};
    if (input.description !== undefined) {
      const trimmed = input.description.trim();
      if (trimmed.length === 0) throw new TaskDescriptionEmptyError();
      patch.description = trimmed;
    }
    if (input.icon !== undefined) patch.icon = input.icon;
    if (input.cover !== undefined) patch.cover = input.cover;
    if (input.coverPosition !== undefined) patch.coverPosition = input.coverPosition;
    if (input.ralphMode !== undefined) patch.ralphMode = input.ralphMode;
    if (input.deadline !== undefined) patch.deadline = input.deadline;
    if (input.startDate !== undefined) patch.startDate = input.startDate;
    if (input.priority !== undefined) patch.priority = input.priority;

    const updated = await this.deps.tasks.update(input.taskId, patch);
    if (!updated) throw new TaskNotFoundError(input.taskId);

    // Снимок версии после правки (для окна версий + restore).
    await this.deps.versions?.record(updated, input.ownerUserId);

    // Логируем в ленту изменений то, что реально поменялось (Notion-style дифф).
    if (this.deps.activity) {
      const changes: ActivityFieldChange[] = [];
      if (patch.description !== undefined && existing.description !== updated.description) {
        changes.push({ field: 'description', old: existing.description ?? null, new: updated.description ?? null });
      }
      if (patch.ralphMode !== undefined && existing.ralphMode !== updated.ralphMode) {
        changes.push({ field: 'ralphMode', old: existing.ralphMode ?? null, new: updated.ralphMode ?? null });
      }
      if (patch.deadline !== undefined && existing.deadline !== updated.deadline) {
        changes.push({ field: 'deadline', old: existing.deadline ?? null, new: updated.deadline ?? null });
      }
      if (patch.priority !== undefined && existing.priority !== updated.priority) {
        changes.push({
          field: 'priority',
          old: existing.priority != null ? String(existing.priority) : null,
          new: updated.priority != null ? String(updated.priority) : null,
        });
      }
      if (changes.length > 0) {
        await this.deps.activity.record({
          projectId: input.projectId,
          actorUserId: input.ownerUserId,
          kind: 'task_updated',
          payload: { taskId: updated.id, taskExcerpt: taskTitle(updated.description), changes },
        });
      }
    }
    return updated;
  }
}
