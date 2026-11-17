import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { LiveEvent } from './LiveEvent';
import type { LiveSession } from './LiveSession';
import { liveFeedRows } from './LiveFeedRows';
import {
  liveEventRole,
  parseCheckResultPayload,
  parseHandoffPayload,
  parseReviewVerdictPayload,
  parseStagePayload,
  pipelineProgress,
  summarizeToolJournal,
} from './LivePipeline';
import { taskLiveTimeline } from './TaskLiveTimeline';

const fixture = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../e2e/smoke/live-orchestrator-run.json', import.meta.url)), 'utf8')) as {
  agentName: string; events: Array<{ at: number; kind: string; text?: string; payload?: unknown }>;
};
const start = new Date(Date.UTC(2026, 10, 17, 9, 0));
const events: LiveEvent[] = fixture.events.map((item, index) => ({
  seq: index + 1, kind: item.kind, text: item.text ?? null, payload: item.payload ?? null, createdAt: new Date(start.getTime() + item.at * 1000),
}));
const session = (agentName: string, status: LiveSession['status'] = 'running'): LiveSession => ({
  id: 's', taskId: 't', projectId: 'p', agentName, attempt: 1, status, model: null, headBefore: null, headAfter: null,
  costUsd: null, tokensIn: null, tokensOut: null, eventCount: events.length, lastSeq: events.length, startedAt: start, endedAt: null,
});
const stage = (seq: number, payload: unknown): LiveEvent => ({ seq, kind: 'stage', text: null, payload, createdAt: start });
const states = (progress: ReturnType<typeof pipelineProgress>) => progress?.steps.map(step => step.state).join(' ');

test('roles: actor, round and escalation are read forward-compatibly', () => {
  const pipeline = session(fixture.agentName);
  assert.deepEqual(liveEventRole({ payload: { actor: 'reviewer', round: 2 } }, pipeline), { actor: 'reviewer', round: 2, escalated: false });
  assert.deepEqual(liveEventRole({ payload: { actor: 'executor', round: 4, escalated: true } }, pipeline), { actor: 'executor', round: 4, escalated: true });
  // No actor, an unknown one or junk → the executor, as the feed showed everything before.
  assert.deepEqual(liveEventRole({ payload: null }, pipeline), { actor: 'executor', round: null, escalated: false });
  assert.deepEqual(liveEventRole({ payload: { actor: 'planner', round: 0, escalated: 'yes' } }, pipeline), { actor: 'executor', round: null, escalated: false });
  assert.deepEqual(liveEventRole({ payload: { actor: 'reviewer', round: 1.5 } }, pipeline).round, null);
  // Old ralph-worker sessions are entirely the executor.
  assert.equal(liveEventRole({ payload: { actor: 'reviewer' } }, session('ralph-worker')).actor, 'executor');
});

test('stepper: the full fixture ends in a running version check after the escalated round', () => {
  const progress = pipelineProgress(events, 'running');
  assert.equal(states(progress), 'passed passed passed passed passed passed active');
  assert.equal(progress?.round, 4);
  assert.equal(progress?.escalated, true);
  assert.equal(progress?.outcome, 'running');
});

test('stepper: a restarted stage resets later stages, failures stay red, finished runs are not «in progress»', () => {
  const failedReview = [
    stage(1, { stage: 'execute', status: 'started', round: 1 }), stage(2, { stage: 'execute', status: 'passed' }),
    stage(3, { stage: 'checks', status: 'passed' }), stage(4, { stage: 'review', status: 'failed', round: 1 }),
  ];
  assert.equal(states(pipelineProgress(failedReview, 'running')), 'pending passed passed failed pending pending pending');
  const nextRound = [...failedReview, stage(5, { stage: 'execute', status: 'started', round: 2 })];
  assert.equal(states(pipelineProgress(nextRound, 'running')), 'pending active pending pending pending pending pending');
  assert.equal(pipelineProgress(nextRound, 'running')?.round, 2);
  assert.equal(states(pipelineProgress(nextRound, 'failed')), 'pending failed pending pending pending pending pending');
  assert.equal(pipelineProgress(nextRound, 'canceled')?.outcome, 'stopped');
  const blocked = [...nextRound, stage(6, { stage: 'blocked', detail: 'Нет доступа к репозиторию' })];
  assert.equal(pipelineProgress(blocked, 'running')?.outcome, 'blocked');
  assert.equal(states(pipelineProgress(blocked, 'running')), 'pending failed pending pending pending pending pending');
  assert.equal(pipelineProgress([...events, stage(999, { stage: 'health', status: 'passed' }), stage(1000, { stage: 'done' })], 'completed')?.outcome, 'done');
  // Sessions without stage events have no stepper; skipped stages are kept.
  assert.equal(pipelineProgress([{ ...stage(1, null), kind: 'assistant_text' }], 'running'), null);
  assert.equal(states(pipelineProgress([stage(1, { stage: 'deliver', status: 'skipped' })], 'running')), 'pending pending pending pending pending skipped pending');
});

test('payload readers reject malformed data instead of throwing', () => {
  for (const junk of [null, 'x', [], { stage: 'lunch', status: 'started' }, { stage: 'checks', status: 'maybe' }]) assert.equal(parseStagePayload(junk), null);
  assert.equal(parseCheckResultPayload({ exitCode: 0 }), null);
  assert.deepEqual(parseCheckResultPayload({ name: 'build', command: ['dotnet', 3, 'build'], exitCode: 2, durationMs: -1, phase: 'other' }),
    { phase: 'checks', name: 'build', command: ['dotnet', 'build'], exitCode: 2, durationMs: null, outputTail: null, passed: false });
  assert.equal(parseReviewVerdictPayload({ approved: 'yes' }), null);
  assert.deepEqual(parseReviewVerdictPayload({ approved: false, findings: [{ severity: 'minor', text: 'b' }, { text: '' }, { severity: 'odd', text: 'c', line: 0 }, { severity: 'blocker', text: 'a', file: 'x.cs', line: 3 }] })?.findings,
    [{ severity: 'blocker', file: 'x.cs', line: 3, text: 'a' }, { severity: 'minor', file: null, line: null, text: 'b' }, { severity: 'minor', file: null, line: null, text: 'c' }]);
  assert.deepEqual(parseHandoffPayload({ from: 'reviewer', to: 'nobody', round: 3, escalated: true }), { from: 'reviewer', to: null, reason: null, round: 3, escalated: true });
});

test('feed rows: one journal per executor round, the avatar once per role turn, silent stages skipped', () => {
  const runs = [{ session: session(fixture.agentName), events, fileDiffs: [] }];
  const rows = liveFeedRows(taskLiveTimeline(runs, []), runs);
  const journals = rows.filter(row => row.kind === 'tools');
  assert.deepEqual(journals.map(row => row.kind === 'tools' ? `${row.role.round}:${row.events.length}` : ''), ['1:5', '2:2', '3:4', '4:4']);
  assert.deepEqual(summarizeToolJournal(journals[2].kind === 'tools' ? journals[2].events : []), { files: 2, commands: 1, tools: 0, errors: 1 });
  // Plain «passed» stages repeat the stepper and are not rows; those with a detail are.
  const stageRows = rows.flatMap(row => row.kind === 'event' && row.event.kind === 'stage' ? [parseStagePayload(row.event.payload)!] : []);
  assert.ok(stageRows.every(item => item.status !== 'passed' || item.detail));
  // Round 1 of the executor: header on its text, then the journal and the closing text share the turn.
  const round1 = rows.filter(row => (row.kind === 'event' || row.kind === 'tools') && row.role?.actor === 'executor' && row.role.round === 1);
  assert.deepEqual(round1.map(row => (row.kind === 'event' || row.kind === 'tools') && row.header), [true, false, false]);
  // A handoff divider ends the turn: the next orchestrator row names itself again.
  const afterHandoff = rows.findIndex(row => row.kind === 'event' && row.event.kind === 'handoff') + 1;
  const next = rows[afterHandoff];
  assert.ok(next.kind === 'event' && next.role?.actor === 'orchestrator' && next.header);
  // Legacy sessions are untouched.
  const legacy = [{ session: session('ralph-worker'), events, fileDiffs: [] }];
  const legacyRows = liveFeedRows(taskLiveTimeline(legacy, []), legacy);
  assert.equal(legacyRows.filter(row => row.kind === 'event').length, events.length);
  assert.ok(legacyRows.every(row => row.kind !== 'tools' && (row.kind !== 'event' || (row.role === null && !row.header))));
});
