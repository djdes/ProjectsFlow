import { TaskCommentBodyEmptyError, TaskNotFoundError } from '../../domain/task/errors.js';
import type { TaskComment } from '../../domain/task/TaskComment.js';
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
  readonly idGen: () => string;
};

export type CreateTaskCommentCommand = {
  readonly projectId: string;
  readonly ownerUserId: string;
  readonly taskId: string;
  readonly body: string;
};

export class CreateTaskComment {
  constructor(private readonly deps: Deps) {}

  async execute(input: CreateTaskCommentCommand): Promise<TaskComment> {
    const body = input.body.trim();
    if (body.length === 0) throw new TaskCommentBodyEmptyError();

    await requireProjectAccess(this.deps, input.projectId, input.ownerUserId, 'create_comment');
    const task = await this.deps.tasks.getById(input.taskId);
    if (!task || task.projectId !== input.projectId) throw new TaskNotFoundError(input.taskId);

    return this.deps.comments.create({
      id: this.deps.idGen(),
      taskId: input.taskId,
      ownerUserId: input.ownerUserId,
      body,
    });
  }
}
