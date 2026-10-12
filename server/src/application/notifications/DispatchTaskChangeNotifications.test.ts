import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DispatchTaskChangeNotifications } from './DispatchTaskChangeNotifications.js';
import { TaskVersionRecorder } from '../task/TaskVersionRecorder.js';
import type { Task } from '../../domain/task/Task.js';
import type { TaskChange } from '../../domain/notifications/TaskChange.js';
import type { CreateNotificationInput } from './NotificationRepository.js';
import type { SendAgentNotificationCommand } from '../telegram/SendAgentTelegramNotification.js';
import type { EmailMessage } from './EmailSender.js';
import { UpdateTask } from '../task/UpdateTask.js';

function task(patch: Partial<Task> = {}): Task {
  return {
    id: 't1', projectId: 'p1', createdBy: 'boss', description: 'Проверить сайт',
    assignee: { userId: 'worker', displayName: 'Исполнитель', avatarUrl: null },
    status: 'manual', statusBeforeDone: null, deadline: '2026-10-12', startDate: null,
    priority: null, taskType: null, ralphMode: 'normal', icon: null, cover: null, coverPosition: 50,
    parentTaskId: null, position: 1, ralphCancelRequestedAt: null, ralphCancelRequestedBy: null,
    ralphCancelRequestedByDisplayName: null, createdAt: new Date(), updatedAt: new Date(),
    ...patch,
  };
}

function harness(options: { inbox?: boolean; failEmail?: boolean; emailOff?: boolean; hidden?: string[] } = {}) {
  const site: CreateNotificationInput[] = [];
  const telegram: SendAgentNotificationCommand[] = [];
  const email: EmailMessage[] = [];
  const users = { getById: async (id: string) => ({ id, displayName: id, email: `${id}@example.test` }) };
  const projects = { getById: async (id: string) => ({ id, name: id === 'p1' ? 'Проект' : 'Секретный проект',
    workspaceId: id === 'p1' ? 'w1' : 'w2', isInbox: options.inbox ?? false, ownerId: 'worker' }) };
  const members = {
    listApproverUserIdsForProject: async (id: string) => id === 'p1' ? ['boss', 'lead', 'lead'] : ['newBoss'],
    findForProject: async (id: string, userId: string) => (id === 'p1'
      ? ['worker', 'boss', 'lead', 'other', 'newWorker'] : ['newWorker', 'newBoss']).includes(userId)
      ? { userId, role: userId === 'worker' ? 'viewer' : 'editor' } : null,
    isProjectHidden: async (_id: string, userId: string) => options.hidden?.includes(userId) ?? false,
    getNotificationPrefs: async () => options.emailOff ? { task_updated: { team: false, mcp: false } } : null,
    listSharedUsers: async () => [{ id: 'worker' }],
  };
  let seq = 0;
  const service = new DispatchTaskChangeNotifications({
    projects: projects as never, members: members as never, users: users as never,
    notifications: { create: async (input: CreateNotificationInput) => { site.push(input); } } as never,
    email: { send: async (msg) => { if (options.failEmail) throw new Error('SMTP unavailable'); email.push(msg); } },
    telegram: { execute: async (cmd) => { telegram.push(cmd); return { status: 'ok', messageId: ++seq, chatId: seq }; } },
    appUrl: 'https://pf.test', idGen: () => `n${++seq}`,
  });
  const run = (actor: string | null, patch: Partial<Task>, fields: TaskChange['changedFields'], before = task()) =>
    service.execute({ actorUserId: actor, previous: before, task: task({ ...before, ...patch }), changedFields: fields });
  function recipients(expected: string[]) {
    assert.deepEqual(site.map((n) => n.userId).sort(), [...expected].sort());
    assert.deepEqual(telegram.map((n) => n.userId).sort(), [...expected].sort());
    if (!options.failEmail && !options.emailOff) assert.deepEqual(email.map((n) => n.to).sort(), expected.map((id) => `${id}@example.test`).sort());
  }
  return { service, site, telegram, email, run, recipients, projects, members };
}

test('manager changes deadline: assignee and other approvers receive old/new dates on all channels', async () => {
  const h = harness();
  await h.run('boss', { deadline: '2026-10-20' }, ['deadline']);
  h.recipients(['worker', 'lead']);
  assert.match(h.email[0]!.text, /Срок до: 12.10.2026 → 20.10.2026/u);
  assert.equal(h.site[0]!.payload.type, 'task_changed');
  assert.ok(h.telegram.every((msg) => msg.skipDedupCheck));
});

test('assignee edits description, date range, priority or attachments: only owner and approvers', async () => {
  for (const fields of [['description'], ['deadline'], ['priority'], ['files']] as const) {
    const h = harness();
    await h.run('worker', { description: 'Другой текст', startDate: '2026-10-11' }, fields);
    h.recipients(['boss', 'lead']);
  }
});

test('assignee completes task with or without approval: no self or unrelated colleagues', async () => {
  for (const status of ['pending_approval', 'done'] as const) {
    const h = harness();
    await h.run('worker', { status }, ['status']);
    h.recipients(['boss', 'lead']);
    assert.match(h.email[0]!.subject, status === 'pending_approval' ? /ждёт утверждения/u : /завершена/u);
  }
});

test('manager accepts, completes, deletes or restores: assignee and other manager', async () => {
  for (const fields of [['status'], ['deleted'], ['restored']] as const) {
    const h = harness();
    await h.run('lead', { status: 'done' }, fields, task({ status: 'pending_approval' }));
    h.recipients(['worker', 'boss']);
    if (fields[0] === 'status') assert.match(h.email[0]!.subject, /принята/u);
    if (fields[0] === 'deleted') {
      assert.ok(h.telegram.every((n) => JSON.stringify(n.replyMarkup).includes('/notifications')));
      assert.equal(h.site[0]!.payload.type === 'task_changed' && h.site[0]!.payload.taskAvailable, false);
    }
  }
});

test('return and withdrawal from approval are distinguished', async () => {
  for (const actor of ['lead', 'worker']) {
    const h = harness();
    await h.run(actor, { status: 'manual' }, ['status'], task({ status: 'pending_approval' }));
    h.recipients(actor === 'worker' ? ['boss', 'lead'] : ['worker', 'boss']);
    assert.match(h.email[0]!.subject, actor === 'worker' ? /отозвана/u : /доработку/u);
  }
});

test('reassignment informs old/new assignees and approvers once, excluding actor', async () => {
  const h = harness();
  await h.run('boss', { assignee: { userId: 'newWorker', displayName: 'Новый', avatarUrl: null } }, ['assignee']);
  h.recipients(['worker', 'newWorker', 'lead']);
});

test('cross-workspace move: former audience receives only old context, never new private details', async () => {
  const h = harness();
  await h.run('boss', { projectId: 'p2', description: 'СЕКРЕТ', assignee: { userId: 'newWorker', displayName: 'Секретный', avatarUrl: null } }, ['project', 'assignee']);
  h.recipients(['worker', 'lead', 'newWorker', 'newBoss']);
  for (const message of h.email.filter((m) => ['worker@example.test', 'lead@example.test'].includes(m.to))) {
    assert.doesNotMatch(message.text, /СЕКРЕТ|Секретный|\/p2/u);
  }
});

test('inbox approvers receive task-scoped changes even without inbox project membership', async () => {
  const h = harness({ inbox: true });
  await h.run('worker', { deadline: null }, ['deadline']);
  h.recipients(['boss', 'lead']);
});

test('explicitly hidden project never leaks to a workspace approver', async () => {
  const h = harness({ hidden: ['lead'] });
  await h.run('worker', { deadline: null }, ['deadline']);
  h.recipients(['boss']);
});

test('email failure does not suppress site, Telegram or another recipient', async () => {
  const h = harness({ failEmail: true });
  await h.run('worker', { deadline: null }, ['deadline']);
  h.recipients(['boss', 'lead']);
});

test('email opt-out is channel specific; no-op snapshot produces no notification', async () => {
  const h = harness({ emailOff: true });
  await h.run('worker', {}, []);
  assert.equal(h.site.length, 0);
  await h.run('worker', { deadline: null }, ['deadline']);
  h.recipients(['boss', 'lead']);
  assert.equal(h.email.length, 0);
});

test('user content is escaped in email and Telegram', async () => {
  const h = harness();
  await h.run('worker', { description: '<script>alert(1)</script>&' }, ['description']);
  assert.doesNotMatch(h.email[0]!.html, /<script>/u);
  assert.match(h.telegram[0]!.text, /&lt;script&gt;/u);
});

test('UpdateTask → saved snapshot → all channels; history failure does not lose notifications', async () => {
  const h = harness();
  const current = task();
  const pending: Promise<void>[] = [];
  const recorder = new TaskVersionRecorder({
    versions: { create: async () => { throw new Error('history unavailable'); } } as never,
    idGen: () => 'v1', onChanged: (change) => { const p = h.service.execute(change); pending.push(p); return p; },
  });
  const tasks = {
    getById: async () => current,
    update: async (_id: string, patch: Partial<Task>, actor: string) => {
      const updated = { ...current, ...patch };
      await recorder.record(updated, actor, current);
      return updated;
    },
  };
  const update = new UpdateTask({ projects: h.projects as never, members: h.members as never,
    tasks: tasks as never, approval: {} as never });
  await update.execute({ projectId: 'p1', taskId: 't1', ownerUserId: 'worker', description: undefined, deadline: '2026-10-23' });
  await Promise.all(pending);
  h.recipients(['boss', 'lead']);
  assert.match(h.email[0]!.text, /12.10.2026 → 23.10.2026/u);
});
