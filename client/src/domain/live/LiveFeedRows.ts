import type { LiveEvent } from './LiveEvent';
import type { TaskLiveEntry, TaskLiveRun } from './TaskLiveTimeline';
import {
  EXECUTOR_TOOL_KINDS, isPipelineSession, liveEventRole, parseCheckResultPayload, parseReviewVerdictPayload,
  parseStagePayload, type LiveEventRole, type LiveStagePayload,
} from './LivePipeline';

// One feed line per stage entry: `started` opens it, the matching passed / failed /
// skipped turns the same line into the result. `live` — the stage the running session is
// in right now (spinner); an opened stage that never got a result stays neutral.
export type LiveFeedStage = { readonly payload: LiveStagePayload; readonly live: boolean };

// What the LIVE feed renders: timeline entries, with the executor's tool noise of a
// pipeline round folded into one journal row. `header` marks the first row of a role
// turn (avatar + name), so consecutive rows of one role read as a single message.
export type LiveFeedRow =
  | Exclude<TaskLiveEntry, { kind: 'event' }>
  | (Extract<TaskLiveEntry, { kind: 'event' }> & {
    readonly role: LiveEventRole | null; readonly header: boolean; readonly stage?: LiveFeedStage;
  })
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
      // A lone «passed» (no line was opened for it) repeats the stepper; it shows up only
      // with something to say.
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

// The result keeps what the start said only where the result is silent: a finished
// stage is named by its label, not by the «in progress» title of its start.
function closeStage(started: LiveStagePayload, result: LiveStagePayload): LiveStagePayload {
  return { ...result, detail: result.detail ?? started.detail, round: result.round ?? started.round };
}

export function liveFeedRows(entries: readonly TaskLiveEntry[], runs: readonly TaskLiveRun[]): LiveFeedRow[] {
  const pipeline = new Set(runs.filter(run => isPipelineSession(run.session)).map(run => run.session.id));
  const running = new Set(runs.filter(run => run.session.status === 'running').map(run => run.session.id));
  const rows: LiveFeedRow[] = [];
  const journals = new Map<string, { events: LiveEvent[] }>();
  // Opened stage lines by `session:stage` → row index; the latest opened per session.
  const openStages = new Map<string, number>();
  const lastOpened = new Map<string, string>();
  let turn: string | null = null;
  // The turn before a divider: an orchestrator stage line right after a handoff continues it.
  let beforeDivider: string | null = null;
  for (const entry of entries) {
    if (entry.kind !== 'event' || !pipeline.has(entry.sessionId)) {
      rows.push(entry.kind === 'event' ? { ...entry, role: null, header: false } : entry);
      turn = null;
      beforeDivider = null;
      continue;
    }
    const role = liveEventRole(entry.event);
    const roleKey = `${entry.sessionId}:${role.actor}:${role.escalated}`;
    const stage = entry.event.kind === 'stage' ? parseStagePayload(entry.event.payload) : null;
    if (stage && stage.stage !== 'done' && stage.stage !== 'blocked') {
      const stageKey = `${entry.sessionId}:${stage.stage}`;
      if (stage.status === 'started') {
        const header = turn !== roleKey && !(turn === null && beforeDivider === roleKey);
        openStages.set(stageKey, rows.length);
        lastOpened.set(entry.sessionId, stageKey);
        rows.push({ ...entry, role, header, stage: { payload: stage, live: false } });
        turn = roleKey;
        continue;
      }
      const at = openStages.get(stageKey);
      const opened = at !== undefined ? rows[at] : undefined;
      if (opened?.kind === 'event' && opened.stage
        && (stage.round === null || opened.stage.payload.round === null || stage.round === opened.stage.payload.round)) {
        openStages.delete(stageKey);
        rows[at!] = { ...opened, stage: { payload: closeStage(opened.stage.payload, stage), live: false } };
        continue;
      }
    }
    if (!visibleInPipeline(entry.event)) continue;
    if (DIVIDER_KINDS.has(entry.event.kind)) {
      rows.push({ ...entry, role, header: false });
      beforeDivider = turn ?? beforeDivider;
      turn = null;
      continue;
    }
    beforeDivider = null;
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
    rows.push({ ...entry, role, header: turn !== roleKey, ...(stage ? { stage: { payload: stage, live: false } } : {}) });
    turn = roleKey;
  }
  // Only the stage the running session is in now spins.
  for (const [sessionId, stageKey] of lastOpened) {
    const at = openStages.get(stageKey);
    const row = at !== undefined ? rows[at] : undefined;
    if (running.has(sessionId) && row?.kind === 'event' && row.stage) rows[at!] = { ...row, stage: { ...row.stage, live: true } };
  }
  return rows;
}
