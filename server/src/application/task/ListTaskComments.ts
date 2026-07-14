import { TaskNotFoundError } from '../../domain/task/errors.js';
import type { TaskComment } from '../../domain/task/TaskComment.js';
import type { TaskAttachment } from '../../domain/task/TaskAttachment.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import { requireTaskReadAccess } from './taskAuthorization.js';
import type { TaskRepository } from './TaskRepository.js';
import type { TaskCommentRepository } from './TaskCommentRepository.js';
import type { TaskAttachmentRepository } from './TaskAttachmentRepository.js';

// Read-model: комментарий + его вложения (для ленты обсуждения).
export type TaskCommentWithAttachments = TaskComment & {
  readonly attachments: TaskAttachment[];
};

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly tasks: TaskRepository;
  readonly comments: TaskCommentRepository;
  readonly attachments: TaskAttachmentRepository;
};

export class ListTaskComments {
  constructor(private readonly deps: Deps) {}

  async execute(
    projectId: string,
    ownerUserId: string,
    taskId: string,
  ): Promise<TaskCommentWithAttachments[]> {
    await requireTaskReadAccess(this.deps, projectId, taskId, ownerUserId);
    const task = await this.deps.tasks.getById(taskId);
    if (!task || task.projectId !== projectId) throw new TaskNotFoundError(taskId);
    const comments = await this.deps.comments.listByTask(taskId);
    const byComment = await this.deps.attachments.listByCommentIds(comments.map((c) => c.id));
    return comments.map((c) => ({ ...c, attachments: byComment.get(c.id) ?? [] }));
  }
}
