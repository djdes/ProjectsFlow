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
