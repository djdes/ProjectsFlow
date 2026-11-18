import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LiveEvent } from './LiveEvent';
import type { LiveSession } from './LiveSession';
import { liveFeedRows } from './LiveFeedRows';
import { parseStagePayload } from './LivePipeline';
import { dispatcherPulse, formatCountdown, retryCaption } from './QueueLiveness';
import { taskLiveTimeline } from './TaskLiveTimeline';

const now = new Date('2026-11-18T10:10:00Z');
const since = new Date('2026-11-18T10:00:00Z');

test('dispatcherPulse: видел очередь / молчит / нет данных / не назначен', () => {
  assert.deepEqual(dispatcherPulse(null, now), { kind: 'unknown' });
  assert.deepEqual(dispatcherPulse({ dispatcherAssigned: false, lastSeenAt: null, trackedSince: since }, now), { kind: 'unassigned' });
  assert.deepEqual(dispatcherPulse({ dispatcherAssigned: true, lastSeenAt: new Date('2026-11-18T10:09:18Z'), trackedSince: since }, now), { kind: 'seen', secondsAgo: 42 });
  assert.deepEqual(dispatcherPulse({ dispatcherAssigned: true, lastSeenAt: new Date('2026-11-18T10:05:00Z'), trackedSince: since }, now), { kind: 'offline', secondsAgo: 300 });
  // Сервер только что перезапущен — молчание ещё ничего не значит.
  assert.deepEqual(dispatcherPulse({ dispatcherAssigned: true, lastSeenAt: null, trackedSince: new Date('2026-11-18T10:09:00Z') }, now), { kind: 'unknown' });
  assert.deepEqual(dispatcherPulse({ dispatcherAssigned: true, lastSeenAt: null, trackedSince: since }, now), { kind: 'offline', secondsAgo: null });
});

test('retryCaption: обратный отсчёт и номер следующей попытки', () => {
  assert.equal(formatCountdown(102_000), '1:42');
  assert.equal(formatCountdown(-5), '0:00');
  const failed = parseStagePayload({ stage: 'prepare', status: 'failed', attempt: 1, maxAttempts: 3, retryAt: '2026-11-18T10:11:42Z' })!;
  assert.equal(retryCaption(failed, now), 'повтор через 1:42, попытка 2 из 3');
  const started = parseStagePayload({ stage: 'prepare', status: 'started', attempt: 2, maxAttempts: 3 })!;
  assert.equal(retryCaption(started, now), 'попытка 2 из 3');
  assert.equal(retryCaption(parseStagePayload({ stage: 'prepare', status: 'started' })!, now), null);
  assert.equal(retryCaption(parseStagePayload({ stage: 'prepare', status: 'passed', runMode: 'full', previousRunMode: 'quick' })!, now), 'режим: Полный прогон');
  // Мусор в полях не ломает разбор: неизвестное — просто не показываем.
  const junk = parseStagePayload({ stage: 'prepare', status: 'started', attempt: 'x', retryAt: 'never', extra: { a: 1 } })!;
  assert.equal(junk.attempt, null);
  assert.equal(junk.retryAt, null);
});

test('ralph-worker: этап подготовки рисуется строкой этапа, результат закрывает её', () => {
  const start = new Date('2026-11-18T10:00:00Z');
  const ev = (seq: number, payload: unknown, kind = 'stage'): LiveEvent => ({ seq, kind, text: null, payload, createdAt: new Date(start.getTime() + seq * 1000) });
  const session: LiveSession = {
    id: 'w', taskId: 't', projectId: 'p', agentName: 'ralph-worker', attempt: 1, status: 'running', model: null, headBefore: null, headAfter: null,
    costUsd: null, tokensIn: null, tokensOut: null, eventCount: 4, lastSeq: 4, startedAt: start, endedAt: null,
  };
  const events = [
    ev(1, { stage: 'prepare', status: 'started', title: 'Готовим рабочую копию', attempt: 1, maxAttempts: 3 }),
    ev(2, { stage: 'prepare', status: 'failed', detail: 'git fetch: timeout', attempt: 1, retryAt: '2026-11-18T10:02:00Z' }),
    ev(3, { stage: 'prepare', status: 'started', title: 'Готовим рабочую копию', attempt: 2, maxAttempts: 3 }),
    ev(4, { stage: 'teleport', status: 'warp' }),
    // Диспетчер повторяет «В очереди» раз в 20 с — строка обновляется, а не множится.
    ev(5, { actor: 'orchestrator', stage: 'prepare', status: 'started', title: 'В очереди', queuePosition: 2, slots: 1 }),
    ev(6, { actor: 'orchestrator', stage: 'prepare', status: 'started', title: 'В очереди', queuePosition: 1, slots: 1 }),
  ];
  const runs = [{ session, events, fileDiffs: [] }];
  const rows = liveFeedRows(taskLiveTimeline(runs, []), runs).filter(row => row.kind === 'event');
  const stages = rows.flatMap(row => row.kind === 'event' && row.stage ? [row.stage] : []);
  assert.equal(stages.length, 2);
  assert.equal(stages[0]!.payload.status, 'failed');
  assert.equal(stages[0]!.payload.maxAttempts, 3, 'итог попытки помнит «из 3» из старта');
  assert.equal(stages[0]!.payload.retryAt?.toISOString(), '2026-11-18T10:02:00.000Z');
  assert.equal(stages[1]!.payload.title, 'В очереди');
  assert.equal(stages[1]!.payload.queuePosition, 1);
  assert.equal(retryCaption(stages[1]!.payload, now), 'место в очереди: 1');
  assert.equal(stages[1]!.live, true, 'идущая подготовка крутит спиннер');
  // Неизвестный этап не ломает ленту: остаётся обычным событием.
  assert.equal(rows.length, 3);
});
