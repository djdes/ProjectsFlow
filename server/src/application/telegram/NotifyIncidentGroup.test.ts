import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NotifyIncidentGroup, incidentMessageText } from './NotifyIncidentGroup.js';
import { signIncidentRequest } from './composer/incidentIntake.js';
import { HandleTelegramWebhook, type TelegramUpdate } from './HandleTelegramWebhook.js';
import type { Task } from '../../domain/task/Task.js';

// Уточнение автору инцидента (spec 2026-11-17, раздел 3): вопрос воркера уходит в группу
// reply'ем на исходное сообщение, ответ reply'ем возвращается комментарием ralph-answer.
const KEY = 'k'.repeat(40);
const CHAT = -100777;

function incidentTask(overrides: Partial<Task> = {}): Task {
  const description = signIncidentRequest('Не печатается отчёт', {
    chatId: CHAT, userId: 555, messageId: 42, messageThreadId: null, senderName: 'Мария <Склад>',
  }, 'project', KEY);
  return {
    id: 'task', projectId: 'project', status: 'awaiting_clarification', deletedAt: null, description,
    assignee: { userId: 'u-lead', displayName: 'Олег' }, ...overrides,
  } as Task;
}

function harness(task: Task | null, opts: { incident?: boolean; actor?: string } = {}) {
  const sent: Array<{ chatId: number; text: string; replyToMessageId?: number }> = [];
  const mapped: unknown[] = [];
  const uc = new NotifyIncidentGroup({
    tasks: { async getById() { return task; } },
    projects: { async getById() { return { id: 'project', dispatcherUserId: 'dispatcher' }; } } as never,
    members: { async getRole() { return null; }, async isMember() { return false; } } as never,
    client: { async sendMessage(i) { sent.push(i); return { kind: 'ok' as const, messageId: 900 }; } },
    incidentChats: { async isIncident(id) { return opts.incident !== false && id === CHAT; } },
    ralphQuestionMessages: { async upsert(i) { mapped.push(i); } },
    signingKey: () => KEY,
  });
  return { uc, sent, mapped };
}

test('incident question: reply to the author in the group, plain text, mapped for the answer', async () => {
  const h = harness(incidentTask());
  const r = await h.uc.execute({ actorUserId: 'dispatcher', taskId: 'task', kind: 'incident_question', text: 'В каком окне? <!-- ralph-question {"id":"q1"} -->', ralphQuestionId: 'q1' });
  assert.deepEqual(r, { status: 'ok', chatId: CHAT, messageId: 900 });
  assert.equal(h.sent[0]!.chatId, CHAT);
  assert.equal(h.sent[0]!.replyToMessageId, 42);
  assert.match(h.sent[0]!.text, /tg:\/\/user\?id=555">Мария &lt;Склад&gt;<\/a>/);
  assert.match(h.sent[0]!.text, /Нужно небольшое уточнение:\nВ каком окне\?\n\nОтветьте прямо на это сообщение/);
  assert.doesNotMatch(h.sent[0]!.text, /ralph-question/);
  assert.deepEqual(h.mapped, [{ tgChatId: CHAT, tgMessageId: 900, recipientUserId: 'u-lead', taskId: 'task', ralphQuestionId: 'q1' }]);
});

test('incident blocked: «передали разработчику» plus the worker reason, no mapping', async () => {
  const h = harness(incidentTask());
  await h.uc.execute({ actorUserId: 'dispatcher', taskId: 'task', kind: 'incident_blocked', text: 'Пришлите скриншот <ошибки>' });
  assert.match(h.sent[0]!.text, /передали разработчику\.\n\nПришлите скриншот &lt;ошибки&gt;/);
  assert.equal(h.mapped.length, 0);
});

test('incident blocked: generic worker text is not duplicated', () => {
  const t = incidentMessageText('incident_blocked', { userId: 1, senderName: 'A' }, 'Автоматически сделать не удалось, задачу передали разработчику.');
  assert.equal(t.match(/передали разработчику/g)?.length, 1);
});

test('incident notify: unsigned task, moved task or non-incident group never reach Telegram', async () => {
  for (const [task, incident] of [
    [incidentTask({ description: 'обычная задача' }), true],
    [incidentTask({ projectId: 'other' }), true],
    [incidentTask(), false],
  ] as const) {
    const h = harness(task, { incident });
    const r = await h.uc.execute({ actorUserId: 'dispatcher', taskId: 'task', kind: 'incident_question', text: '?', ralphQuestionId: 'q' });
    assert.equal(r.status, 'not_incident');
    assert.equal(h.sent.length, 0);
  }
});

test('incident notify: only the project dispatcher may write to the group', async () => {
  const h = harness(incidentTask());
  await assert.rejects(h.uc.execute({ actorUserId: 'stranger', taskId: 'task', kind: 'incident_blocked', text: '' }));
  assert.equal(h.sent.length, 0);
});

test('incidentMessageText escapes the question', () => {
  assert.match(incidentMessageText('incident_question', { userId: 1, senderName: '' }, '<b>x</b>'), /Автор запроса[\s\S]*&lt;b&gt;x&lt;\/b&gt;/);
});

test('incident group: reply to the question from a member without account becomes ralph-answer and reopens', async () => {
  const comments: Array<{ ownerUserId: string; body: string; taskId: string }> = [];
  const reopened: string[] = [];
  const sent: string[] = [];
  const deps = {
    users: { async findUserIdByTelegramUserId() { return null; } },
    members: {},
    tasks: { async getById() { return incidentTask(); } },
    client: { async sendMessage(i: { text: string }) { sent.push(i.text); return { kind: 'ok' as const, messageId: 1 }; } },
    appUrl: 'https://pf.test',
    botUsername: 'ProjectsFlow_Bot',
    ralphQuestionMessages: {
      async findByMessage(chat: number, mid: number) {
        return chat === CHAT && mid === 900 ? { tgChatId: CHAT, tgMessageId: 900, recipientUserId: 'u-lead', taskId: 'task', ralphQuestionId: 'q1', sentAt: new Date() } : null;
      },
    },
    taskMessages: { async findByMessage() { return null; } },
    createComment: { async execute(c: { ownerUserId: string; body: string; taskId: string }) { comments.push(c); return { id: 'c1' }; } },
    dispatchCommentNotifications: {},
    groupOwners: { async getOwnerUserId() { return null; } },
    composer: { async startFromMessage() { throw new Error('reply must not become a new task'); } },
    workGroups: { async resolveChat() { return { workspaceId: 'ws', workspaceName: 'YesBeat', mode: 'incident' as const, addedByUserId: 'u-lead' }; } },
    maybeReopenForClarification: { async execute(id: string) { reopened.push(id); return { oldStatus: 'awaiting_clarification', newStatus: 'in_progress' }; } },
    notifyTaskChanged() {},
    notifyCommentAdded() {},
    notifyStatusChanged() {},
  };
  const h = new HandleTelegramWebhook(deps as never);
  await h.execute({
    update_id: 5,
    message: {
      message_id: 77,
      from: { id: 555, first_name: 'Мария' },
      chat: { id: CHAT, type: 'supergroup', title: 'Инциденты' },
      text: 'В окне печати накладных',
      reply_to_message: { message_id: 900, from: { id: 1, is_bot: true, first_name: 'PF' }, chat: { id: CHAT, type: 'supergroup' }, text: '❓' },
    },
  } as unknown as TelegramUpdate);
  assert.equal(comments.length, 1);
  assert.equal(comments[0]!.ownerUserId, 'u-lead');
  assert.match(comments[0]!.body, /через группу Telegram, Мария/);
  assert.match(comments[0]!.body, /<!-- ralph-answer \{"v":1,"q":"q1","value":"В окне печати накладных"/);
  assert.deepEqual(reopened, ['task']);
  assert.match(sent.at(-1)!, /Спасибо, ответ получен/);
});
