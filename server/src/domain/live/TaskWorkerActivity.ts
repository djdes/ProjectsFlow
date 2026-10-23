export type TaskWorkerActivity = {
  readonly taskId: string;
  readonly state: 'running' | 'question' | 'error';
  readonly sessionId: string | null;
  readonly questionCommentId: string | null;
};

export type WorkerActivitySession = {
  readonly taskId: string;
  readonly id: string;
  readonly status: string;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
};
export type WorkerActivityComment = {
  readonly taskId: string;
  readonly id: string;
  readonly actorKind: string;
  readonly body: string;
  readonly createdAt: Date;
};

function marker(body: string, kind: 'question' | 'answer'): Record<string, unknown> | null {
  const match = body.match(kind === 'question'
    ? /<!--\s*ralph-question\s+([\s\S]*?)\s*-->/
    : /<!--\s*ralph-answer\s+([\s\S]*?)\s*-->/);
  if (!match) return null;
  try {
    const value: unknown = JSON.parse(match[1]!);
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}

// Recovered tool errors and CLI warnings do not mean that work has failed. Only
// the latest run's final status or a real unanswered dispatcher question needs attention.
export function taskWorkerActivities(sessions: readonly WorkerActivitySession[], comments: readonly WorkerActivityComment[]): TaskWorkerActivity[] {
  const latest = new Map(sessions.map(session => [session.taskId, session]));
  const answers = new Map<string, number>();
  for (const comment of comments) {
    if (comment.actorKind !== 'user') continue;
    const answer = marker(comment.body, 'answer');
    const id = answer?.q ?? answer?.qid;
    if (typeof id !== 'string' || !id) continue;
    const key = `${comment.taskId}:${id}`;
    answers.set(key, Math.max(answers.get(key) ?? 0, +comment.createdAt));
  }
  const questions = new Map<string, WorkerActivityComment>();
  for (const comment of comments) {
    if (comment.actorKind !== 'agent') continue;
    const question = marker(comment.body, 'question');
    const id = question?.id ?? question?.qid;
    if (typeof id !== 'string' || !id || (answers.get(`${comment.taskId}:${id}`) ?? -1) >= +comment.createdAt) continue;
    const session = latest.get(comment.taskId);
    if (session && +comment.createdAt < +session.startedAt) continue;
    if (session && ['completed', 'canceled'].includes(session.status) && session.endedAt && +comment.createdAt <= +session.endedAt) continue;
    const previous = questions.get(comment.taskId);
    if (!previous || +previous.createdAt <= +comment.createdAt) questions.set(comment.taskId, comment);
  }
  const result: TaskWorkerActivity[] = [];
  for (const taskId of new Set([...latest.keys(), ...questions.keys()])) {
    const session = latest.get(taskId);
    const question = questions.get(taskId);
    const state = question ? 'question' : session?.status === 'running' ? 'running'
      : session && ['failed', 'timeout'].includes(session.status) ? 'error' : null;
    if (state) result.push({ taskId, state, sessionId: session?.id ?? null, questionCommentId: question?.id ?? null });
  }
  return result;
}
