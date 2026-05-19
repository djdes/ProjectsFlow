import { can } from '../../domain/project/permissions.js';
import {
  InsufficientProjectRoleError,
} from '../../domain/project/errors.js';
import {
  TaskCommentNotFoundError,
  TaskNotFoundError,
} from '../../domain/task/errors.js';
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

export class DeleteTaskComment {
  constructor(private readonly deps: Deps) {}

  async execute(
    projectId: string,
    ownerUserId: string,
    taskId: string,
    commentId: string,
  ): Promise<void> {
    // Базовый чек: член проекта вообще (минимум viewer). Дальше — own vs any.
    const { membership } = await requireProjectAccess(
      this.deps,
      projectId,
      ownerUserId,
      'delete_own_comment',
    );
    const task = await this.deps.tasks.getById(taskId);
    if (!task || task.projectId !== projectId) throw new TaskNotFoundError(taskId);
    const existing = await this.deps.comments.getById(commentId);
    if (!existing || existing.taskId !== taskId) throw new TaskCommentNotFoundError(commentId);

    // Свой комментарий → разрешено. Чужой → нужен delete_any_comment (editor+).
    if (existing.ownerUserId !== ownerUserId && !can(membership.role, 'delete_any_comment')) {
      throw new InsufficientProjectRoleError(membership.role, 'delete_any_comment');
    }

    await this.deps.comments.delete(commentId);
  }
}
