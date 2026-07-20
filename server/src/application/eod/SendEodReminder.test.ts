import assert from 'node:assert/strict';
import test from 'node:test';
import { SendEodReminder } from './SendEodReminder.js';

type Sent = { userId: string; text: string };

function makeHarness(opts: {
  memberIds: string[];
  tasks: Array<{ id: string; status: string; assigneeUserId: string; description: string }>;
}): { service: SendEodReminder; sent: Sent[]; group: string[] } {
  const sent: Sent[] = [];
  const group: string[] = [];

  const service = new SendEodReminder({
    projects: { getById: async () => ({ id: 'p1', name: 'Проект' }) } as never,
    members: {
      listByProject: async () => opts.memberIds.map((userId) => ({ userId })),
    } as never,
    tasks: {
      listByProject: async () =>
        opts.tasks.map((t) => ({
          id: t.id,
          status: t.status,
          description: t.description,
          assignee: { userId: t.assigneeUserId },
        })),
    } as never,
    tgSend: {
      execute: async (cmd: { userId: string; text: string }) => {
        sent.push({ userId: cmd.userId, text: cmd.text });
        return { status: 'ok', messageId: 1, chatId: 1 } as never;
      },
    } as never,
    appUrl: 'https://app.example',
    telegramClient: {
      sendMessage: async (cmd: { text: string }) => {
        group.push(cmd.text);
        return { messageId: 1, chatId: -1 } as never;
      },
    } as never,
    getGroupChatId: async () => -1007,
  });

  return { service, sent, group };
}

test('EOD: личное напоминание только тем, у кого есть незакрытые задачи', async () => {
  const h = makeHarness({
    memberIds: ['A', 'B', 'C'],
    tasks: [
      { id: 't1', status: 'in_progress', assigneeUserId: 'A', description: 'Починить логин' },
      { id: 't2', status: 'todo', assigneeUserId: 'A', description: 'Обновить доки' },
      { id: 't3', status: 'done', assigneeUserId: 'B', description: 'Уже закрыта' },
    ],
  });

  await h.service.execute('p1');

  // A — есть открытые задачи. B (всё закрыто) и C (задач нет вовсе) личное НЕ получают.
  assert.deepEqual(h.sent.map((s) => s.userId), ['A']);
  assert.match(h.sent[0]!.text, /Починить логин/);
  assert.match(h.sent[0]!.text, /Обновить доки/);
  // Групповой нудж не тронут — уходит как раньше.
  assert.equal(h.group.length, 1);
});

test('EOD: соло-проект и проект без открытых задач молчат полностью', async () => {
  const solo = makeHarness({
    memberIds: ['A'],
    tasks: [{ id: 't1', status: 'todo', assigneeUserId: 'A', description: 'Задача' }],
  });
  await solo.service.execute('p1');
  assert.deepEqual(solo.sent, []);
  assert.deepEqual(solo.group, []);

  const allClosed = makeHarness({
    memberIds: ['A', 'B'],
    tasks: [{ id: 't1', status: 'done', assigneeUserId: 'A', description: 'Задача' }],
  });
  await allClosed.service.execute('p1');
  assert.deepEqual(allClosed.sent, []);
  assert.deepEqual(allClosed.group, []);
});
