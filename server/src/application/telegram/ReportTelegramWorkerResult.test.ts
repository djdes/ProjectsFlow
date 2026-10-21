import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReportTelegramWorkerResult } from './ReportTelegramWorkerResult.js';
import type { TelegramTaskOrigin, TelegramTaskOriginRepository } from './TelegramTaskOriginRepository.js';
import type { SendMessageInput, SendMessageResult } from './TelegramClient.js';
import type { Task } from '../../domain/task/Task.js';
import type { TaskCommit } from '../../domain/task/TaskCommit.js';
import type { TelegramLink } from '../../domain/telegram/TelegramLink.js';

function harness() {
  let clock = new Date('2026-10-20T10:00:00Z');
  let row: TelegramTaskOrigin | null = { taskId: 't', projectId: 'p', chatId: -100123, messageId: 42, requestedAt: null };
  let sentAt: Date | null = null;
  let retryAt: Date | null = null;
  let claimUntil: Date | null = null;
  let claimToken: string | null = null;
  let seq = 0;
  const messages: SendMessageInput[] = [];
  let sendResult: SendMessageResult = { kind: 'ok', messageId: 100 };
  let link: TelegramLink | null = null;
  let task = { id: 't', projectId: 'p', status: 'done', deletedAt: null, description: '**Исправить кнопку**\n\nТекст' } as Task | null;
  let commits = [{ taskId: 't', sha: 'abcdef1234567890', message: 'Убрана лишняя кнопка <готово>', htmlUrl: 'https://github.com/acme/app/commit/abcdef1234567890', committedAt: clock }] as TaskCommit[];
  const eligible = (now: Date) => !!row?.requestedAt && !sentAt && (!retryAt || retryAt <= now) && (!claimUntil || claimUntil <= now);
  const origins: TelegramTaskOriginRepository = {
    async attach() {},
    async getByTask(id) { return row?.taskId === id ? { ...row } : null; },
    async requestResult(_id, now) { if (row && !row.requestedAt && !sentAt) row = { ...row, requestedAt: now }; },
    async listDue(now) { return eligible(now) && row ? [{ ...row }] : []; },
    async claim(_id, token, now, until) {
      if (!eligible(now)) return false;
      claimToken = token;
      claimUntil = until;
      return true;
    },
    async finish(_id, token, now) { if (token === claimToken) { sentAt = now; claimToken = null; claimUntil = null; } },
    async retry(_id, token, at) { if (token === claimToken) { retryAt = at; claimToken = null; claimUntil = null; } },
  };
  const deps = {
    origins,
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
    service, origins, messages,
    newService: () => new ReportTelegramWorkerResult(deps),
    setResult: (value: SendMessageResult) => { sendResult = value; },
    setLink: (value: TelegramLink | null) => { link = value; },
    setTask: (value: Task | null) => { task = value; },
    get task() { return task!; },
    setCommits: (value: TaskCommit[]) => { commits = value; },
    get commits() { return commits; },
    removeOrigin: () => { row = null; },
    advance: (ms: number) => { clock = new Date(clock.getTime() + ms); },
    queued: () => !!row?.requestedAt,
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
  h.origins.recoverCompleted = async (now) => { await h.origins.requestResult('t', now); };
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
  await h.origins.requestResult('t', new Date('2026-10-20T10:00:00Z'));
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
