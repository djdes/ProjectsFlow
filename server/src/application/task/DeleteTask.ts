import { TaskNotFoundError } from '../../domain/task/errors.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import { requireProjectAccess } from '../project/projectAccess.js';
import type { TaskRepository } from './TaskRepository.js';
import type { TaskCommentRepository } from './TaskCommentRepository.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly tasks: TaskRepository;
  readonly comments: TaskCommentRepository;
};

export class DeleteTask {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, ownerUserId: string, taskId: string): Promise<void> {
    await requireProjectAccess(this.deps, projectId, ownerUserId, 'delete_task');

    const task = await this.deps.tasks.getById(taskId);
    if (!task || task.projectId !== projectId) throw new TaskNotFoundError(taskId);

    // Чистим комментарии до удаления задачи — иначе останутся orphan-записи.
    // (Attachments и task_commits на серверной стороне не каскадятся — это уже отдельная
    // история; здесь касаемся только новой таблицы.)
    await this.deps.comments.deleteByTask(taskId);

    const ok = await this.deps.tasks.delete(taskId);
    if (!ok) throw new TaskNotFoundError(taskId);
  }
}
