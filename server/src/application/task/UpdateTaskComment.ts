import {
  InsufficientProjectRoleError,
} from '../../domain/project/errors.js';
import {
  TaskCommentBodyEmptyError,
  TaskCommentNotFoundError,
  TaskNotFoundError,
} from '../../domain/task/errors.js';
import type { TaskComment } from '../../domain/task/TaskComment.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { TaskRepository } from './TaskRepository.js';
import type { TaskCommentRepository } from './TaskCommentRepository.js';
import { requireTaskModifyAccess } from './taskAuthorization.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly tasks: TaskRepository;
  readonly comments: TaskCommentRepository;
};

export type UpdateTaskCommentCommand = {
  readonly projectId: string;
  readonly ownerUserId: string;
  readonly taskId: string;
  readonly commentId: string;
  readonly body: string;
};

export class UpdateTaskComment {
  constructor(private readonly deps: Deps) {}

  async execute(input: UpdateTaskCommentCommand): Promise<TaskComment> {
    const body = input.body.trim();
    if (body.length === 0) throw new TaskCommentBodyEmptyError();

    // Право «писать комментарии вообще» — viewer+. Дополнительно ниже проверяем
    // что юзер редактирует свой собственный комментарий (own-only edit; модерация
    // чужих комментариев editor'ом — отдельная фича).
    await requireTaskModifyAccess(
      this.deps,
      input.projectId,
      input.taskId,
      input.ownerUserId,
      'update_own_comment',
    );
    const task = await this.deps.tasks.getById(input.taskId);
    if (!task || task.projectId !== input.projectId) throw new TaskNotFoundError(input.taskId);
    const existing = await this.deps.comments.getById(input.commentId);
    if (!existing || existing.taskId !== input.taskId) {
      throw new TaskCommentNotFoundError(input.commentId);
    }
    if (existing.ownerUserId !== input.ownerUserId) {
      throw new InsufficientProjectRoleError('viewer', 'update_own_comment');
    }

    const updated = await this.deps.comments.update({ id: input.commentId, body });
    if (!updated) throw new TaskCommentNotFoundError(input.commentId);
    return updated;
  }
}
