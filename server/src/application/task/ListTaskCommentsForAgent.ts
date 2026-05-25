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

export class ListTaskCommentsForAgent {
  constructor(private readonly deps: Deps) {}

  async execute(
    projectId: string,
    ownerUserId: string,
    taskId: string,
    filters: ListTaskCommentsFilters,
  ): Promise<TaskCommentForAgent[]> {
    await requireProjectAccess(this.deps, projectId, ownerUserId, 'read_project');
    const task = await this.deps.tasks.getById(taskId);
    if (!task || task.projectId !== projectId) throw new TaskNotFoundError(taskId);

    const comments = await this.deps.comments.listByTaskFiltered(taskId, filters);
    if (comments.length === 0) return [];

    // Батч user-lookup для ownerDisplayName (избегаем N+1).
    const uniqueIds = Array.from(new Set(comments.map((c) => c.ownerUserId)));
    const users = await this.deps.users.getManyByIds(uniqueIds);
    const nameById = new Map(users.map((u) => [u.id, u.displayName]));

    return comments.map((c) => ({ ...c, ownerDisplayName: nameById.get(c.ownerUserId) ?? null }));
  }
}
