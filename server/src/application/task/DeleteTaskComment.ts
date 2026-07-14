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
import type { TaskRepository } from './TaskRepository.js';
import type { TaskCommentRepository } from './TaskCommentRepository.js';
import { requireTaskModifyAccess } from './taskAuthorization.js';

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
    // Inbox-aware authorization. Для inbox: владелец или текущий ответственный
    // могут удалять ТОЛЬКО собственные комментарии (нет delete_any_comment
    // в inbox — нет ролей кроме owner/assignee). Для проектов: editor+ может
    // удалять любые (стандартная логика).
    const { project } = await requireTaskModifyAccess(
      this.deps,
      projectId,
      taskId,
      ownerUserId,
      'delete_own_comment',
    );
    const task = await this.deps.tasks.getById(taskId);
    if (!task || task.projectId !== projectId) throw new TaskNotFoundError(taskId);
    const existing = await this.deps.comments.getById(commentId);
    if (!existing || existing.taskId !== taskId) throw new TaskCommentNotFoundError(commentId);

    if (project.isInbox) {
      // Inbox: только свой комментарий. Чужой нельзя удалять ни владельцу, ни ответственному.
      if (existing.ownerUserId !== ownerUserId) {
        throw new InsufficientProjectRoleError('viewer', 'delete_any_comment');
      }
    } else {
      // Non-inbox: получаем membership для роль-чека delete_any_comment.
      const membership = await this.deps.members.findForProject(projectId, ownerUserId);
      if (!membership) {
        // Не должно случиться (requireTaskModifyAccess уже прошёл), но safe fallback.
        throw new InsufficientProjectRoleError('viewer', 'delete_any_comment');
      }
      if (existing.ownerUserId !== ownerUserId && !can(membership.role, 'delete_any_comment')) {
        throw new InsufficientProjectRoleError(membership.role, 'delete_any_comment');
      }
    }

    await this.deps.comments.delete(commentId);
  }
}
