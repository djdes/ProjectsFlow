import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReportTelegramWorkerResult } from './ReportTelegramWorkerResult.js';
import { FakeWorkerResultOutbox } from './FakeWorkerResultOutbox.test-helper.js';
import type { WorkerResultDestination } from './TelegramWorkerResultOutbox.js';
import type { TelegramTaskOrigin } from './TelegramTaskOriginRepository.js';
import type { SendMessageInput, SendMessageResult } from './TelegramClient.js';
import type { Task } from '../../domain/task/Task.js';
import type { TaskCommit } from '../../domain/task/TaskCommit.js';
import type { TelegramLink } from '../../domain/telegram/TelegramLink.js';

function harness() {
  let clock = new Date('2026-10-20T10:00:00Z');
  let row: TelegramTaskOrigin | null = { taskId: 't', projectId: 'p', chatId: -100123, messageId: 42, requestedAt: null };
  let seq = 0;
  let configured: WorkerResultDestination | null = null;
  const messages: SendMessageInput[] = [];
  let sendResult: SendMessageResult = { kind: 'ok', messageId: 100 };
  let link: TelegramLink | null = null;
  let task = { id: 't', projectId: 'p', status: 'done', deletedAt: null, description: '**Исправить кнопку**\n\nТекст' } as Task | null;
  let commits = [{ taskId: 't', sha: 'abcdef1234567890', message: 'Убрана лишняя кнопка <готово>', htmlUrl: 'https://github.com/acme/app/commit/abcdef1234567890', committedAt: clock }] as TaskCommit[];
  const origins = {
    async getByTask(id: string) { return row?.taskId === id ? { ...row } : null; },
  };
  const deps = {
    origins,
    outbox: new FakeWorkerResultOutbox(),
    destinations: { async resolve(task: Task): Promise<WorkerResultDestination | null> {
      return row ? (row.projectId === task.projectId ? { ...row, source: 'origin' } : null) : configured;
    } },
    tasks: { async getById() { return task; } },
    commits: { async listByTask() { return commits; } },
    projects: { async getById() { return { id: 'p', dispatcherUserId: 'dispatcher' }; } } as never,
    members: {} as never,
    client: { async sendMessage(input: SendMessageInput) { messages.push(input); return sendResult; } },
    users: { async getTelegramLink() { return link; } },
    now: () => clock,
    idGen: () => `lease-${++seq}`,
  };
  const service = new ReportTelegramWorkerResult(deps);
  return {
    service, origins, messages, outbox: deps.outbox,
    newService: () => new ReportTelegramWorkerResult(deps),
    setResult: (value: SendMessageResult) => { sendResult = value; },
    setLink: (value: TelegramLink | null) => { link = value; },
    setTask: (value: Task | null) => { task = value; },
    get task() { return task!; },
    setCommits: (value: TaskCommit[]) => { commits = value; },
    get commits() { return commits; },
    removeOrigin: () => { row = null; },
    setReportedAt: (reportedAt: Date) => { if (row) row = { ...row, reportedAt }; },
    setDestination: (value: WorkerResultDestination | null) => { configured = value; },
    advance: (ms: number) => { clock = new Date(clock.getTime() + ms); },
    queued: () => deps.outbox.rows.size > 0,
  };
}

const drain = async (service: ReportTelegramWorkerResult) => {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await service.deliverPending();
};

test('worker result returns to its source group with a verified commit, HTML is escaped and duplicates are suppressed', async () => {
  const h = harness();
  h.setTask({ ...h.task, description: '**Исправить <кнопку>**\n\nТекст' });
  await h.service.request('t', 'dispatcher');
  await drain(h.service);
  assert.equal(h.messages.length, 1);
  assert.equal(h.messages[0]?.chatId, -100123);
  assert.equal(h.messages[0]?.replyToMessageId, 42);
  assert.match(h.messages[0]!.text, /https:\/\/github.com\/acme\/app\/commit\/abcdef1234567890/);
  assert.match(h.messages[0]!.text, /Исправить &lt;кнопку&gt;/);
  assert.doesNotMatch(h.messages[0]!.text, /прод обновлён|деплой ОК/);
  await h.service.request('t', 'dispatcher');
  await drain(h.service);
  await h.newService().deliverPending();
  assert.equal(h.messages.length, 1, 'completion replay and server restart do not resend');
});

test('technical and corrupted git subjects do not leak into the short Telegram report', async () => {
  const h = harness();
  h.setCommits([{ ...h.commits[0]!, message: 'fix(tasks): ╨У╨▒╤А╨░╤В╤М РєРЅРѕРїРєСѓ' }]);
  await h.service.request('t', 'dispatcher');
  await drain(h.service);
  assert.match(h.messages[0]!.text, /Исправить кнопку/);
  assert.match(h.messages[0]!.text, /Коммит abcdef1/);
  assert.doesNotMatch(h.messages[0]!.text, /fix\(tasks\)|╨|РєРЅ/);
});

test('follow-up work on the same task sends another report, replay of either completion does not', async () => {
  const h = harness();
  await h.service.request('t', 'dispatcher');
  await drain(h.service);
  h.advance(60_000);
  h.outbox.completion = { key: 'session:second', startedAt: new Date('2026-10-20T10:01:00Z') };
  await h.service.request('t', 'dispatcher');
  await drain(h.service);
  await h.newService().request('t', 'dispatcher');
  await drain(h.service);
  assert.equal(h.messages.length, 2);
  assert.equal(h.outbox.rows.size, 2);
});

test('legacy report watermark suppresses old runs but allows a new completion', async () => {
  const h = harness();
  h.setReportedAt(new Date('2026-10-20T09:30:00Z'));
  await h.service.request('t', 'dispatcher');
  await drain(h.service);
  assert.equal(h.messages.length, 0);
  h.outbox.completion = { key: 'session:second', startedAt: new Date('2026-10-20T09:59:00Z') };
  await h.service.request('t', 'dispatcher');
  await drain(h.service);
  assert.equal(h.messages.length, 1);
});

test('website task delivers to the configured group and rechecks that binding before a retry', async () => {
  const h = harness();
  h.removeOrigin();
  h.setDestination({ taskId: 't', projectId: 'p', chatId: -100456, messageId: null, source: 'workspace' });
  h.setResult({ kind: 'error', description: 'offline' });
  await h.service.request('t', 'dispatcher');
  await drain(h.service);
  assert.equal(h.messages[0]?.chatId, -100456);
  assert.equal(h.messages[0]?.replyToMessageId, undefined);
  h.setDestination(null);
  h.advance(60_000);
  await h.newService().deliverPending();
  assert.equal(h.messages.length, 1, 'revoked group binding does not receive queued private content');
});

test('no verified worker completion never queues a report', async () => {
  const h = harness();
  h.outbox.completion = null;
  await h.service.request('t', 'dispatcher');
  await drain(h.service);
  assert.equal(h.outbox.rows.size, 0);
});

test('retry of a superseded run cannot report the new run twice', async () => {
  const h = harness();
  h.setCommits([]);
  await h.service.request('t', 'dispatcher');
  await drain(h.service);
  h.advance(60_000);
  h.outbox.completion = { key: 'session:second', startedAt: new Date('2026-10-20T10:01:00Z') };
  h.setCommits([{ taskId: 't', sha: 'abcdef1234567890', htmlUrl: 'https://github.com/acme/app/commit/abcdef1234567890', committedAt: new Date() } as TaskCommit]);
  await h.service.request('t', 'dispatcher');
  await drain(h.service);
  assert.equal(h.messages.length, 1);
});

test('completion mentions the current responsible person by Telegram username', async () => {
  const h = harness();
  h.setTask({ ...h.task, assignee: { userId: 'responsible', displayName: 'Олег', avatarUrl: null } });
  h.setLink({ telegramUsername: 'hotspotping', telegramUserId: 123 } as TelegramLink);
  await h.service.request('t', 'dispatcher');
  await drain(h.service);
  assert.match(h.messages[0]!.text, /^@hotspotping\n/);
});

test('outbox polling recovers a missed completion request without replaying an already delivered report', async () => {
  const h = harness();
  h.setTask({ ...h.task, status: 'pending_approval', assignee: { userId: 'responsible', displayName: 'benzin', avatarUrl: null } });
  h.setLink({ telegramUsername: 'hotspotping', telegramUserId: 123 } as TelegramLink);
  h.outbox.recoverable = ['t'];
  await h.service.deliverPending();
  assert.equal(h.messages.length, 1);
  assert.match(h.messages[0]!.text, /^@hotspotping\n/);
  assert.match(h.messages[0]!.text, /на утверждении/);
  await h.newService().deliverPending();
  assert.equal(h.messages.length, 1);
});

test('a responsible person without a username receives a clickable mention', async () => {
  const h = harness();
  h.setTask({ ...h.task, assignee: { userId: 'responsible', displayName: 'Олег <lead>', avatarUrl: null } });
  h.setLink({ telegramUsername: null, telegramUserId: 123 } as TelegramLink);
  await h.service.request('t', 'dispatcher');
  await drain(h.service);
  assert.match(h.messages[0]!.text, /<a href="tg:\/\/user\?id=123">Олег &lt;lead&gt;<\/a>/);
});

test('an unlinked responsible person is named without inventing a Telegram handle', async () => {
  const h = harness();
  h.setTask({ ...h.task, assignee: { userId: 'responsible', displayName: 'benzin', avatarUrl: null } });
  await h.service.request('t', 'dispatcher');
  await drain(h.service);
  assert.match(h.messages[0]!.text, /^benzin\n/);
  assert.doesNotMatch(h.messages[0]!.text, /@benzin/);
});

test('ordinary members cannot request a report to a group', async () => {
  const h = harness();
  await assert.rejects(() => h.service.request('t', 'ordinary-member'), { name: 'NotAssignedDispatcherError' });
  assert.equal(h.queued(), false);
  assert.equal(h.messages.length, 0);
});

test('non-Telegram, deleted, unfinished and moved tasks produce no report', async () => {
  for (const variant of ['no-origin', 'deleted', 'unfinished', 'moved', 'absent']) {
    const h = harness();
    if (variant === 'no-origin') h.removeOrigin();
    if (variant === 'deleted') h.setTask({ ...h.task, deletedAt: new Date() });
    if (variant === 'unfinished') h.setTask({ ...h.task, status: 'in_progress' });
    if (variant === 'moved') h.setTask({ ...h.task, projectId: 'another-project' });
    if (variant === 'absent') h.setTask(null);
    await h.service.request('t', 'dispatcher');
    await drain(h.service);
    assert.equal(h.messages.length, 0, variant);
  }
});

test('outbox rechecks project and deletion immediately before delivery', async () => {
  const h = harness();
  await h.outbox.enqueue({ id: 'queued', taskId: 't', projectId: 'p', chatId: -100123, messageId: 42, source: 'origin', completionKey: 'first', requestedAt: new Date('2026-10-20T10:00:00Z') });
  h.setTask({ ...h.task, projectId: 'private-project' });
  await h.service.deliverPending();
  assert.equal(h.messages.length, 0);
});

test('approval-required work is reported as awaiting approval', async () => {
  const h = harness();
  h.setTask({ ...h.task, status: 'pending_approval' });
  await h.service.request('t', 'dispatcher');
  await drain(h.service);
  assert.match(h.messages[0]!.text, /на утверждении/);
});

test('Telegram 429 is retried after the provider delay, including after server restart', async () => {
  const h = harness();
  h.setResult({ kind: 'rate_limited', retryAfter: 120 });
  await h.service.request('t', 'dispatcher');
  await drain(h.service);
  assert.equal(h.messages.length, 1);
  h.advance(60_000);
  await h.newService().deliverPending();
  assert.equal(h.messages.length, 1);
  h.advance(60_000);
  h.setResult({ kind: 'ok', messageId: 101 });
  await h.newService().deliverPending();
  assert.equal(h.messages.length, 2);
  await h.newService().deliverPending();
  assert.equal(h.messages.length, 2);
});

test('network failure retries, permanently removed bot does not', async () => {
  for (const kind of ['error', 'forbidden'] as const) {
    const h = harness();
    h.setResult({ kind, description: 'unavailable' });
    await h.service.request('t', 'dispatcher');
    await drain(h.service);
    h.advance(60_000);
    h.setResult({ kind: 'ok', messageId: 101 });
    await h.newService().deliverPending();
    assert.equal(h.messages.length, kind === 'error' ? 2 : 1);
  }
});

test('late commit linking is picked up by the outbox, multiple API processes acquire one claim', async () => {
  const h = harness();
  const commits = h.commits;
  h.setCommits([]);
  await h.service.request('t', 'dispatcher');
  await drain(h.service);
  assert.equal(h.messages.length, 0);
  h.advance(60_000);
  h.setCommits(commits);
  await Promise.all([h.newService().deliverPending(), h.newService().deliverPending()]);
  assert.equal(h.messages.length, 1);
  assert.match(h.messages[0]!.text, /Коммит abcdef1/);
});

test('absence of a commit is reported honestly after five minutes; arbitrary URLs never become links', async () => {
  const h = harness();
  h.setCommits([]);
  await h.service.request('t', 'dispatcher');
  await drain(h.service);
  h.advance(5 * 60_000);
  await h.service.deliverPending();
  assert.match(h.messages[0]!.text, /Коммит к задаче не привязан/);
  const foreign = harness();
  foreign.setCommits([{ ...foreign.commits[0]!, htmlUrl: 'https://attacker.example/phish' }]);
  await foreign.service.request('t', 'dispatcher');
  await drain(foreign.service);
  assert.doesNotMatch(foreign.messages[0]!.text, /attacker/);
});
