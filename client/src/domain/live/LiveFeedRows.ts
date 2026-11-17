import type { LiveEvent } from './LiveEvent';
import type { TaskLiveEntry, TaskLiveRun } from './TaskLiveTimeline';
import {
  EXECUTOR_TOOL_KINDS, isPipelineSession, liveEventRole, parseCheckResultPayload, parseReviewVerdictPayload,
  parseStagePayload, type LiveEventRole,
} from './LivePipeline';

// What the LIVE feed renders: timeline entries, with the executor's tool noise of a
// pipeline round folded into one journal row. `header` marks the first row of a role
// turn (avatar + name), so consecutive rows of one role read as a single message.
export type LiveFeedRow =
  | Exclude<TaskLiveEntry, { kind: 'event' }>
  | (Extract<TaskLiveEntry, { kind: 'event' }> & { readonly role: LiveEventRole | null; readonly header: boolean })
  | {
    readonly kind: 'tools'; readonly key: string; readonly at: Date; readonly sessionId: string;
    readonly role: LiveEventRole; readonly header: boolean; readonly events: LiveEvent[];
  };

// Pipeline events the feed draws. Silent ones must not take the role header with them.
function visibleInPipeline(event: LiveEvent): boolean {
  switch (event.kind) {
    case 'assistant_text': return !!event.text?.trim();
    case 'stage': {
      const stage = parseStagePayload(event.payload);
      // A plain «passed» repeats the stepper; it shows up only with something to say.
      return stage ? stage.status !== 'passed' || !!stage.detail || stage.stage === 'done' : !!event.text;
    }
    case 'check_result': return !!parseCheckResultPayload(event.payload) || !!event.text;
    case 'review_verdict': return !!parseReviewVerdictPayload(event.payload) || !!event.text;
    case 'handoff': return true;
    case 'diff_summary': case 'session_finished': case 'file_diff': return false;
    default: return EXECUTOR_TOOL_KINDS.has(event.kind) || event.kind === 'worker_notice' || !!event.text;
  }
}

// Rows that interrupt a role turn: the next role row shows its avatar again.
const DIVIDER_KINDS: ReadonlySet<string> = new Set(['handoff']);

export function liveFeedRows(entries: readonly TaskLiveEntry[], runs: readonly TaskLiveRun[]): LiveFeedRow[] {
  const pipeline = new Set(runs.filter(run => isPipelineSession(run.session)).map(run => run.session.id));
  const rows: LiveFeedRow[] = [];
  const journals = new Map<string, { events: LiveEvent[] }>();
  let turn: string | null = null;
  for (const entry of entries) {
    if (entry.kind !== 'event' || !pipeline.has(entry.sessionId)) {
      rows.push(entry.kind === 'event' ? { ...entry, role: null, header: false } : entry);
      turn = null;
      continue;
    }
    if (!visibleInPipeline(entry.event)) continue;
    const role = liveEventRole(entry.event);
    if (DIVIDER_KINDS.has(entry.event.kind)) {
      rows.push({ ...entry, role, header: false });
      turn = null;
      continue;
    }
    const roleKey = `${entry.sessionId}:${role.actor}:${role.escalated}`;
    if (role.actor === 'executor' && EXECUTOR_TOOL_KINDS.has(entry.event.kind)) {
      const key = `tools:${entry.sessionId}:${role.round ?? 0}:${role.escalated}`;
      const journal = journals.get(key);
      if (journal) { journal.events.push(entry.event); continue; }
      const events = [entry.event];
      journals.set(key, { events });
      rows.push({ kind: 'tools', key, at: entry.at, sessionId: entry.sessionId, role, header: turn !== roleKey, events });
      turn = roleKey;
      continue;
    }
    rows.push({ ...entry, role, header: turn !== roleKey });
    turn = roleKey;
  }
  return rows;
}
