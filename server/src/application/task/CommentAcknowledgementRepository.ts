import type { CommentAcknowledgement } from '../../domain/task/CommentAcknowledgement.js';

export interface CommentAcknowledgementRepository {
  set(commentId: string, userId: string, accepted: boolean): Promise<void>;
  listByComments(commentIds: readonly string[]): Promise<CommentAcknowledgement[]>;
}
