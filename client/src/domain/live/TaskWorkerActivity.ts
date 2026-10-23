export type TaskWorkerActivity = {
  readonly taskId: string;
  readonly state: 'running' | 'question' | 'error';
  readonly sessionId: string | null;
  readonly questionCommentId: string | null;
};
