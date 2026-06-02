import { TaskNotFoundError } from '../../domain/task/errors.js';
import type { CommentNotifyMode } from '../../domain/task/TaskComment.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import { requireTaskReadAccess } from './taskAuthorization.js';
import type { TaskDelegationRepository } from './TaskDelegationRepository.js';
import type { TaskRepository } from './TaskRepository.js';
import type { TaskCommentRepository } from './TaskCommentRepository.js';
import type {
  CommentNotificationLogRepository,
  CommentNotificationWithUser,
} from '../notifications/CommentNotificationLogRepository.js';

// Read-model для меню ⋮ «Кто уведомлён»: режим адресации + журнал доставки по каналам.
export type CommentNotificationsView = {
  readonly notifyMode: CommentNotifyMode;
  readonly recipients: CommentNotificationWithUser[];
};

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly tasks: TaskRepository;
  readonly comments: TaskCommentRepository;
  readonly log: CommentNotificationLogRepository;
  readonly delegations: TaskDelegationRepository;
};

export class GetCommentNotifications {
  constructor(private readonly deps: Deps) {}

  async execute(
    projectId: string,
    ownerUserId: string,
    taskId: string,
    commentId: string,
  ): Promise<CommentNotificationsView> {
    await requireTaskReadAccess(this.deps, projectId, taskId, ownerUserId);
    const task = await this.deps.tasks.getById(taskId);
    if (!task || task.projectId !== projectId) throw new TaskNotFoundError(taskId);
    const comment = await this.deps.comments.getById(commentId);
    if (!comment || comment.taskId !== taskId) throw new TaskNotFoundError(commentId);
    const recipients = await this.deps.log.listByComment(commentId);
    return { notifyMode: comment.notifyMode, recipients };
  }
}
