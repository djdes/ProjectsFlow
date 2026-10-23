export type CommentAcknowledgement = {
  readonly commentId: string;
  readonly userId: string;
  readonly displayName: string;
  readonly acknowledgedAt: Date;
};
