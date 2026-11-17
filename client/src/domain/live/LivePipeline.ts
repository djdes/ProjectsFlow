import type { LiveEvent } from './LiveEvent';
import type { LiveSession } from './LiveSession';

// Roles of the Ralph pipeline (orchestrator → executor → reviewer). Contract:
// docs/superpowers/specs/2026-11-17-telegram-group-projects-and-worker-orchestrator-design.md §6.
// Every reader here is forward-compatible: unknown values fall back to the legacy view.

export const ORCHESTRATOR_AGENT = 'ralph-orchestrator';

export type LiveActor = 'orchestrator' | 'executor' | 'reviewer';

export type LiveEventRole = {
  readonly actor: LiveActor;
  // Fix cycle number (1-based); null when the event does not say.
  readonly round: number | null;
  // Executor continues with a stronger reasoning effort after the review limit.
  readonly escalated: boolean;
};

const LEGACY_ROLE: LiveEventRole = { actor: 'executor', round: null, escalated: false };
const ACTORS: readonly LiveActor[] = ['orchestrator', 'executor', 'reviewer'];

export function isPipelineSession(session: Pick<LiveSession, 'agentName'>): boolean {
  return session.agentName === ORCHESTRATOR_AGENT;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function round(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function actor(value: unknown): LiveActor | null {
  return ACTORS.includes(value as LiveActor) ? value as LiveActor : null;
}

// Old ralph-worker sessions are entirely the executor. Unknown actors are shown as the
// executor too: that is how the feed rendered them before roles existed.
export function liveEventRole(event: Pick<LiveEvent, 'payload'>, session?: Pick<LiveSession, 'agentName'>): LiveEventRole {
  if (session && !isPipelineSession(session)) return LEGACY_ROLE;
  const payload = record(event.payload);
  if (!payload) return LEGACY_ROLE;
  return {
    actor: actor(payload.actor) ?? 'executor',
    round: round(payload.round),
    escalated: payload.escalated === true,
  };
}

// ---- stage ----

export const PIPELINE_STAGES = ['prepare', 'execute', 'checks', 'review', 'publish', 'deliver', 'health'] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];
export type StageStatus = 'started' | 'passed' | 'failed' | 'skipped';

export type LiveStagePayload = {
  readonly stage: PipelineStage | 'done' | 'blocked';
  readonly status: StageStatus;
  readonly title: string | null;
  readonly detail: string | null;
  readonly round: number | null;
};

const STAGE_STATUSES: readonly StageStatus[] = ['started', 'passed', 'failed', 'skipped'];

export function parseStagePayload(payload: unknown): LiveStagePayload | null {
  const row = record(payload);
  if (!row) return null;
  const stage = row.stage;
  if (!(PIPELINE_STAGES as readonly unknown[]).includes(stage) && stage !== 'done' && stage !== 'blocked') return null;
  const status = STAGE_STATUSES.includes(row.status as StageStatus) ? row.status as StageStatus
    : stage === 'done' ? 'passed' : stage === 'blocked' ? 'failed' : null;
  if (!status) return null;
  return { stage: stage as LiveStagePayload['stage'], status, title: text(row.title), detail: text(row.detail), round: round(row.round) };
}

export type StepState = 'pending' | 'active' | 'passed' | 'failed' | 'skipped';

export type PipelineProgress = {
  readonly steps: ReadonlyArray<{ readonly stage: PipelineStage; readonly state: StepState }>;
  readonly round: number | null;
  readonly escalated: boolean;
  readonly outcome: 'running' | 'done' | 'blocked' | 'stopped';
};

// The stepper reflects the latest `stage` events. A stage that starts again (next fix
// round) resets the stages after it: the earlier review verdict no longer applies.
export function pipelineProgress(events: readonly LiveEvent[], sessionStatus: LiveSession['status']): PipelineProgress | null {
  const states = new Map<PipelineStage, StepState>(PIPELINE_STAGES.map(stage => [stage, 'pending']));
  let seen = false;
  let currentRound: number | null = null;
  let escalated = false;
  let outcome: PipelineProgress['outcome'] = 'running';
  for (const event of events) {
    if (event.kind === 'handoff') {
      const handoff = parseHandoffPayload(event.payload);
      if (handoff?.escalated) escalated = true;
      continue;
    }
    if (event.kind !== 'stage') continue;
    const stage = parseStagePayload(event.payload);
    if (!stage) continue;
    seen = true;
    if (stage.round) currentRound = stage.round;
    if (stage.stage === 'done') { outcome = 'done'; continue; }
    if (stage.stage === 'blocked') {
      outcome = 'blocked';
      for (const [key, state] of states) if (state === 'active') states.set(key, 'failed');
      continue;
    }
    if (stage.status === 'started') {
      const index = PIPELINE_STAGES.indexOf(stage.stage);
      for (const later of PIPELINE_STAGES.slice(index + 1)) states.set(later, 'pending');
      states.set(stage.stage, 'active');
    } else {
      states.set(stage.stage, stage.status);
    }
  }
  if (!seen) return null;
  if (sessionStatus !== 'running' && outcome === 'running') {
    outcome = sessionStatus === 'completed' ? 'done' : 'stopped';
    // A finished session leaves nothing «in progress»: an interrupted stage failed.
    for (const [key, state] of states) if (state === 'active') states.set(key, sessionStatus === 'completed' ? 'passed' : 'failed');
  }
  return { steps: PIPELINE_STAGES.map(stage => ({ stage, state: states.get(stage)! })), round: currentRound, escalated, outcome };
}

// ---- check_result ----

export type CheckPhase = 'checks' | 'delivery' | 'health';

export type LiveCheckResult = {
  readonly phase: CheckPhase;
  readonly name: string;
  readonly command: readonly string[];
  readonly exitCode: number | null;
  readonly durationMs: number | null;
  readonly outputTail: string | null;
  readonly passed: boolean;
};

export function parseCheckResultPayload(payload: unknown): LiveCheckResult | null {
  const row = record(payload);
  const name = text(row?.name);
  if (!row || !name) return null;
  const exitCode = typeof row.exitCode === 'number' && Number.isFinite(row.exitCode) ? row.exitCode : null;
  const durationMs = typeof row.durationMs === 'number' && Number.isFinite(row.durationMs) && row.durationMs >= 0 ? row.durationMs : null;
  const phase = row.phase === 'delivery' || row.phase === 'health' ? row.phase : 'checks';
  const command = Array.isArray(row.command) ? row.command.filter((part): part is string => typeof part === 'string') : [];
  const outputTail = typeof row.outputTail === 'string' && row.outputTail.trim() ? row.outputTail.replace(/\s+$/, '') : null;
  return { phase, name, command, exitCode, durationMs, outputTail, passed: exitCode === 0 };
}

// ---- review_verdict ----

export type FindingSeverity = 'blocker' | 'major' | 'minor';

export type LiveReviewFinding = {
  readonly severity: FindingSeverity;
  readonly file: string | null;
  readonly line: number | null;
  readonly text: string;
};

export type LiveReviewVerdict = {
  readonly round: number | null;
  readonly approved: boolean;
  readonly summary: string | null;
  readonly findings: readonly LiveReviewFinding[];
};

const SEVERITY_ORDER: Record<FindingSeverity, number> = { blocker: 0, major: 1, minor: 2 };

export function parseReviewVerdictPayload(payload: unknown): LiveReviewVerdict | null {
  const row = record(payload);
  if (!row || typeof row.approved !== 'boolean') return null;
  const findings = (Array.isArray(row.findings) ? row.findings : []).flatMap((item): LiveReviewFinding[] => {
    const finding = record(item);
    const body = text(finding?.text);
    if (!finding || !body) return [];
    const severity = finding.severity === 'blocker' || finding.severity === 'major' ? finding.severity : 'minor';
    return [{ severity, file: text(finding.file), line: round(finding.line), text: body }];
  });
  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return { round: round(row.round), approved: row.approved, summary: text(row.summary), findings };
}

// ---- handoff ----

export type LiveHandoff = {
  readonly from: LiveActor | null;
  readonly to: LiveActor | null;
  readonly reason: string | null;
  readonly round: number | null;
  readonly escalated: boolean;
};

export function parseHandoffPayload(payload: unknown): LiveHandoff | null {
  const row = record(payload);
  if (!row) return null;
  return { from: actor(row.from), to: actor(row.to), reason: text(row.reason), round: round(row.round), escalated: row.escalated === true };
}

// ---- executor tool noise ----

// Tool activity of the executor. In a pipeline session it is folded into one journal
// per round; the assistant's own text stays visible.
export const EXECUTOR_TOOL_KINDS: ReadonlySet<string> = new Set(['bash', 'tool_use', 'file_edit', 'file_write', 'tool_error']);

export type ToolJournalSummary = { readonly files: number; readonly commands: number; readonly tools: number; readonly errors: number };

export function summarizeToolJournal(events: readonly LiveEvent[]): ToolJournalSummary {
  const files = new Set<string>();
  let commands = 0, tools = 0, errors = 0;
  for (const event of events) {
    const payload = record(event.payload);
    if (event.kind === 'file_edit' || event.kind === 'file_write') {
      const path = text(payload?.path);
      if (path) files.add(path.replaceAll('\\', '/'));
    } else if (event.kind === 'bash') commands += 1;
    else if (event.kind === 'tool_error') errors += 1;
    else tools += 1;
  }
  return { files: files.size, commands, tools, errors };
}
