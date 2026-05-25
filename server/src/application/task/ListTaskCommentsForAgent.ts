import { ProjectNotFoundError } from '../../domain/project/errors.js';
import { TaskNotFoundError } from '../../domain/task/errors.js';
import type { TaskComment } from '../../domain/task/TaskComment.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import { requireProjectAccess } from '../project/projectAccess.js';
import type { TaskRepository } from './TaskRepository.js';
import type {
  ListTaskCommentsFilters,
  TaskCommentRepository,
} from './TaskCommentRepository.js';
import type { UserRepository } from '../user/UserRepository.js';

// Read-model для agent-API: комментарий + displayName автора. Используется Ralph-диспетчером
// в F11 Q&A (читает comments задачи, ищет ralph-question/ralph-answer маркеры).
export type TaskCommentForAgent = TaskComment & {
  readonly ownerDisplayName: string | null;
};

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly tasks: TaskRepository;
  readonly comments: TaskCommentRepository;
  readonly users: UserRepository;
};

const TRANSIENT_RETRY_DELAY_MS = 80;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ListTaskCommentsForAgent {
  constructor(private readonly deps: Deps) {}

  // Внутренняя функция — попытка прочитать access+task. Может бросить:
  // - ProjectNotFoundError если membership не найден (или admin-bypass не сработал)
  // - TaskNotFoundError если task не найден или ушёл в другой проект
  private async resolveAccess(
    projectId: string,
    ownerUserId: string,
    taskId: string,
  ): Promise<void> {
    await requireProjectAccess(this.deps, projectId, ownerUserId, 'read_project');
    const task = await this.deps.tasks.getById(taskId);
    if (!task || task.projectId !== projectId) throw new TaskNotFoundError(taskId);
  }

  async execute(
    projectId: string,
    ownerUserId: string,
    taskId: string,
    filters: ListTaskCommentsFilters,
  ): Promise<TaskCommentForAgent[]> {
    // См. bug-comments-endpoint-transient-404.md: эндпоинт периодически выдаёт
    // транзиентный 404 для живой задачи. Root cause не локализован, но повторное
    // чтение через ~80мс на проде показывает 200. Retry-on-transient — дефенсивный
    // фикс пока root cause не пойман.
    try {
      await this.resolveAccess(projectId, ownerUserId, taskId);
    } catch (err) {
      if (err instanceof TaskNotFoundError || err instanceof ProjectNotFoundError) {
        await sleep(TRANSIENT_RETRY_DELAY_MS);
        try {
          await this.resolveAccess(projectId, ownerUserId, taskId);
          // Retry помог — лог для аналитики реальной частоты транзиента.
          console.warn(
            `[ListTaskCommentsForAgent.transient_404_recovered] projectId=${projectId} taskId=${taskId} userId=${ownerUserId}`,
          );
        } catch (err2) {
          // Retry тоже не помог — реальный 404. Лог для соответствия с Ralph-логом.
          console.warn(
            `[ListTaskCommentsForAgent.persistent_404] projectId=${projectId} taskId=${taskId} userId=${ownerUserId} err=${(err2 as Error).name}`,
          );
          throw err2;
        }
      } else {
        throw err;
      }
    }

    const comments = await this.deps.comments.listByTaskFiltered(taskId, filters);
    if (comments.length === 0) return [];

    // Батч user-lookup для ownerDisplayName (избегаем N+1).
    const uniqueIds = Array.from(new Set(comments.map((c) => c.ownerUserId)));
    const users = await this.deps.users.getManyByIds(uniqueIds);
    const nameById = new Map(users.map((u) => [u.id, u.displayName]));

    return comments.map((c) => ({ ...c, ownerDisplayName: nameById.get(c.ownerUserId) ?? null }));
  }
}
