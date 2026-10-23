import type { LiveEvent } from './LiveEvent';
import type { LiveFileDiff } from './LiveFileDiff';
import type { LiveSession } from './LiveSession';
import type { TaskComment } from '../task/TaskComment';

export type TaskLiveRun = {
  readonly session: LiveSession;
  readonly events: LiveEvent[];
  readonly fileDiffs: LiveFileDiff[];
};

export type TaskLiveEntry = { readonly key: string; readonly at: Date } & (
  | { readonly kind: 'message'; readonly comment: TaskComment }
  | { readonly kind: 'start'; readonly session: LiveSession }
  | { readonly kind: 'event'; readonly event: LiveEvent; readonly sessionId: string }
  | { readonly kind: 'finish'; readonly run: TaskLiveRun }
);

// The task is one conversation. Execution boundaries are inline history, not tabs.
export function taskLiveTimeline(runs: readonly TaskLiveRun[], comments: readonly TaskComment[]): TaskLiveEntry[] {
  const entries: TaskLiveEntry[] = comments
    .filter(comment => comment.actorKind === 'user')
    .map(comment => ({ kind: 'message', key: `comment:${comment.id}`, at: comment.createdAt, comment }));
  for (const run of runs) {
    const { session } = run;
    entries.push({ kind: 'start', key: `start:${session.id}`, at: session.startedAt, session });
    for (const event of run.events) entries.push({ kind: 'event', key: `event:${session.id}:${event.seq}`, at: event.createdAt, event, sessionId: session.id });
    if (session.status !== 'running') entries.push({
      kind: 'finish', key: `finish:${session.id}`,
      at: session.endedAt ?? run.events.at(-1)?.createdAt ?? session.startedAt, run,
    });
  }
  const rank = { start: 0, message: 1, event: 2, finish: 3 };
  return entries.sort((a, b) => a.at.getTime() - b.at.getTime() || rank[a.kind] - rank[b.kind]
    || (a.kind === 'event' && b.kind === 'event' ? a.event.seq - b.event.seq : a.key.localeCompare(b.key)));
}
