export type TaskCommit = {
  readonly taskId: string;
  readonly sha: string;
  readonly message: string;
  readonly authorName: string;
  readonly authorAvatarUrl: string | null;
  readonly htmlUrl: string;
  readonly committedAt: Date;
  readonly linkedAt: Date;
};
