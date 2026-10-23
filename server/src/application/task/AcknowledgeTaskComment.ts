import { TaskCommentNotFoundError } from '../../domain/task/errors.js';
import type { CommentAcknowledgement } from '../../domain/task/CommentAcknowledgement.js';
import type { CommentAcknowledgementRepository } from './CommentAcknowledgementRepository.js';
import type { TaskCommentRepository } from './TaskCommentRepository.js';
import { requireTaskReadAccess, type TaskAccessDeps } from './taskAuthorization.js';

// Reading a task is enough to acknowledge a message. This never edits the task,
// posts a comment, approves work or resumes a worker.
export class AcknowledgeTaskComment {
  constructor(private readonly deps: TaskAccessDeps & {
    comments: TaskCommentRepository;
    acknowledgements: CommentAcknowledgementRepository;
    onChanged?: (projectId: string, userIds: readonly string[]) => void;
  }) {}

  async execute(projectId: string, taskId: string, commentId: string, userId: string, accepted: boolean): Promise<CommentAcknowledgement[]> {
    await requireTaskReadAccess(this.deps, projectId, taskId, userId);
    const comment = await this.deps.comments.getById(commentId);
    if (!comment || comment.taskId !== taskId) throw new TaskCommentNotFoundError(commentId);
    await this.deps.acknowledgements.set(commentId, userId, accepted);
    const result = await this.deps.acknowledgements.listByComments([commentId]);
    this.deps.onChanged?.(projectId, [userId, comment.ownerUserId]);
    return result;
  }
}
