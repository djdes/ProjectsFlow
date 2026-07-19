import { TaskNotFoundError } from '../../domain/task/errors.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { TaskRepository } from './TaskRepository.js';
import { requireTaskDeleteAccess } from './taskAuthorization.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly tasks: TaskRepository;
};

/**
 * «Удалить навсегда» одну задачу из корзины: физический DELETE вместе со всеми
 * child-строками, отката уже не будет. Ручной аналог автоочистки PurgeTrashedTasks.
 */
export class PurgeDeletedTask {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, actorUserId: string, taskId: string): Promise<void> {
    // Право то же, что на удаление и восстановление.
    await requireTaskDeleteAccess(this.deps, projectId, actorUserId, 'delete_task');

    const trashed = await this.deps.tasks.getByIdIncludingDeleted(taskId);
    if (!trashed || trashed.projectId !== projectId) throw new TaskNotFoundError(taskId);

    // Живую задачу через корзину не сносим: физическое удаление в обход softDelete
    // лишило бы пользователя Undo. Сначала обычное удаление, потом уже purge.
    if (!trashed.deletedAt) throw new TaskNotFoundError(taskId);

    const ok = await this.deps.tasks.deleteWithChildren(taskId);
    if (!ok) throw new TaskNotFoundError(taskId);
  }
}
