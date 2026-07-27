import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BroadcastTelegramNotificationByTask } from './BroadcastTelegramNotificationByTask.js';
import type {
  SendAgentNotificationCommand,
  SendAgentNotificationResult,
} from './SendAgentTelegramNotification.js';

// Мини-фейки над узкими Pick-портами (конвенция репо: ручные in-memory стабы, без mock-библиотек).
type Seed = {
  // null → задачи нет (проверяем 404-путь).
  assigneeUserId: string | null;
  result?: SendAgentNotificationResult;
  // Руководители пространства проекта — вторая аудитория (роль 'lead').
  leadUserIds?: string[];
};

function makeBroadcast(seed: Seed): {
  svc: BroadcastTelegramNotificationByTask;
  sent: SendAgentNotificationCommand[];
} {
  const sent: SendAgentNotificationCommand[] = [];
  const svc = new BroadcastTelegramNotificationByTask({
    tasks: {
      async getById(id: string) {
        if (seed.assigneeUserId === null) return null;
        return {
          id,
          projectId: 'p1',
          assignee: { userId: seed.assigneeUserId, displayName: 'Ответственный', avatarUrl: null },
        } as never;
      },
    },
    send: {
      async execute(cmd: SendAgentNotificationCommand): Promise<SendAgentNotificationResult> {
        sent.push(cmd);
        return seed.result ?? { status: 'ok', messageId: 42, chatId: 1 };
      },
    },
    members: {
      async listLeadUserIdsForProject() {
        return seed.leadUserIds ?? [];
      },
    },
  });
  return { svc, sent };
}

const baseCmd = { text: 'привет', kind: 'status_change', respectPrefs: true } as const;

// Главный инвариант: аудитория — ТОЛЬКО ответственный, а не все участники пространства.
test('шлёт только ответственному задачи', async () => {
  const { svc, sent } = makeBroadcast({ assigneeUserId: 'u-assignee' });

  const res = await svc.execute({ taskId: 't1', ...baseCmd });

  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.userId, 'u-assignee');
  // projectId задачи прокидывается — от него зависят авто-действия «Завершить/Комментировать».
  assert.equal(sent[0]?.projectId, 'p1');
  assert.equal(res.sent, 1);
  assert.deepEqual(res.delivered, [{ userId: 'u-assignee', messageId: 42 }]);
});

test('ответственный и есть актор → не шлём ничего (skipped self)', async () => {
  const { svc, sent } = makeBroadcast({ assigneeUserId: 'u-me' });

  const res = await svc.execute({ taskId: 't1', ...baseCmd, skipUserId: 'u-me' });

  assert.equal(sent.length, 0);
  assert.equal(res.sent, 0);
  assert.deepEqual(res.skipped, [{ userId: 'u-me', reason: 'self' }]);
});

test('актор — не ответственный → ответственный всё равно получает', async () => {
  const { svc, sent } = makeBroadcast({ assigneeUserId: 'u-assignee' });

  const res = await svc.execute({ taskId: 't1', ...baseCmd, skipUserId: 'u-other' });

  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.userId, 'u-assignee');
  assert.equal(res.sent, 1);
});

test('выключенный pref у ответственного → skipped, без доставки', async () => {
  const { svc } = makeBroadcast({
    assigneeUserId: 'u-assignee',
    result: { status: 'pref_off', kind: 'statusChange' },
  });

  const res = await svc.execute({ taskId: 't1', ...baseCmd });

  assert.equal(res.sent, 0);
  assert.deepEqual(res.skipped, [{ userId: 'u-assignee', reason: 'pref_off' }]);
  assert.deepEqual(res.delivered, []);
});

test('нет задачи → TaskNotFoundError', async () => {
  const { svc } = makeBroadcast({ assigneeUserId: null });

  await assert.rejects(() => svc.execute({ taskId: 'missing', ...baseCmd }));
});

// --- Руководитель (role='lead') ---
// Копия события уходит ему в ЛИЧНЫЙ чат (send работает только с личной привязкой юзера),
// поэтому в общие группы командный поток не попадает by construction.

test('руководитель получает копию события в личку', async () => {
  const { svc, sent } = makeBroadcast({ assigneeUserId: 'u-assignee', leadUserIds: ['u-lead'] });

  const res = await svc.execute({ taskId: 't1', ...baseCmd });

  assert.deepEqual(sent.map((c) => c.userId), ['u-assignee', 'u-lead']);
  // Отдельный kind — своё окно дедупа и свой pref-ключ (teamStatusChange).
  assert.equal(sent[1]?.kind, 'team_status_change');
  // Префикс с именем ответственного: командный поток отличим от своих задач.
  assert.ok(sent[1]?.text.startsWith('👤 <b>Ответственный</b>\n'));
  assert.equal(res.sent, 2);
});

test('ответственный сам сделал действие → ему тихо, руководителю всё равно уходит', async () => {
  const { svc, sent } = makeBroadcast({ assigneeUserId: 'u-me', leadUserIds: ['u-lead'] });

  const res = await svc.execute({ taskId: 't1', ...baseCmd, skipUserId: 'u-me' });

  assert.deepEqual(sent.map((c) => c.userId), ['u-lead']);
  assert.equal(res.sent, 1);
  assert.deepEqual(res.skipped, [{ userId: 'u-me', reason: 'self' }]);
});

test('руководитель — сам актор → себе не шлём', async () => {
  const { svc, sent } = makeBroadcast({ assigneeUserId: 'u-assignee', leadUserIds: ['u-lead'] });

  await svc.execute({ taskId: 't1', ...baseCmd, skipUserId: 'u-lead' });

  assert.deepEqual(sent.map((c) => c.userId), ['u-assignee']);
});

test('руководитель — сам ответственный → одно сообщение, без дубля', async () => {
  const { svc, sent } = makeBroadcast({ assigneeUserId: 'u-lead', leadUserIds: ['u-lead'] });

  await svc.execute({ taskId: 't1', ...baseCmd });

  assert.deepEqual(sent.map((c) => c.userId), ['u-lead']);
  assert.equal(sent[0]?.kind, 'status_change');
});

test('не-ключевое событие (комментарий) в командный поток не идёт', async () => {
  const { svc, sent } = makeBroadcast({ assigneeUserId: 'u-assignee', leadUserIds: ['u-lead'] });

  await svc.execute({ taskId: 't1', text: 'коммент', kind: 'comment_on_my_task', respectPrefs: true });

  assert.deepEqual(sent.map((c) => c.userId), ['u-assignee']);
});

test('prefs руководителя уважаем даже при respectPrefs=false у ответственного', async () => {
  const { svc, sent } = makeBroadcast({ assigneeUserId: 'u-assignee', leadUserIds: ['u-lead'] });

  await svc.execute({ taskId: 't1', ...baseCmd, respectPrefs: false });

  assert.equal(sent[0]?.skipPrefsCheck, true);
  assert.equal(sent[1]?.skipPrefsCheck, false);
});
