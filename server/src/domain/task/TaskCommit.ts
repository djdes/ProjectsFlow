// Snapshot коммита, привязанного к задаче. message/author/date кешируются у нас —
// рендерим без GitHub API. При force-push на репо snapshot останется со старым текстом
// (приемлемо для operational notebook).
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
