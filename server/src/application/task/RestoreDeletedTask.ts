import { TaskNotFoundError } from '../../domain/task/errors.js';
import type { Task } from '../../domain/task/Task.js';
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
 * Восстановление задачи из корзины (db/134). Возвращает задачу с ТЕМ ЖЕ id —
 * это и есть смысл мягкого удаления: комментарии, версии, привязанные коммиты и
 * внешние ссылки на задачу переживают откат.
 */
export class RestoreDeletedTask {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, actorUserId: string, taskId: string): Promise<Task> {
    // Право то же, что на удаление: кто мог отправить в корзину — тот может и вернуть.
    await requireTaskDeleteAccess(this.deps, projectId, actorUserId, 'delete_task');

    // Именно IncludingDeleted: обычный getById удалённую задачу уже не видит.
    const trashed = await this.deps.tasks.getByIdIncludingDeleted(taskId);
    if (!trashed || trashed.projectId !== projectId) throw new TaskNotFoundError(taskId);

    // Задача не в корзине — восстанавливать нечего. Возвращаем как есть, чтобы
    // повторный клик «Отменить» не падал ошибкой (идемпотентность Undo).
    if (!trashed.deletedAt) return trashed;

    const restored = await this.deps.tasks.restore(taskId);
    if (!restored) throw new TaskNotFoundError(taskId);
    return restored;
  }
}
