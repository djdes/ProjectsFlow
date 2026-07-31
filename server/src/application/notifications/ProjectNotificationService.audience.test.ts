import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProjectNotificationService } from './ProjectNotificationService.js';

// Аудитория писем о задачах. С единым пространством «участник проекта» — это вся команда,
// поэтому раньше любое действие сотрудника рассылалось всем. Правило: письма о задаче
// получают руководители пространства и ответственный за неё, но не остальные сотрудники.

const PROJECT_ID = 'p1';

const MEMBERS = [
  { userId: 'boss', role: 'owner', notificationPrefs: null, user: { displayName: 'Босс', email: 'boss@x' } },
  { userId: 'lead', role: 'lead', notificationPrefs: null, user: { displayName: 'Лид', email: 'lead@x' } },
  { userId: 'employee', role: 'editor', notificationPrefs: null, user: { displayName: 'Сотрудник', email: 'employee@x' } },
  { userId: 'other', role: 'editor', notificationPrefs: null, user: { displayName: 'Коллега', email: 'other@x' } },
];

function make() {
  const sent: string[] = [];
  const svc = new ProjectNotificationService({
    projects: { getById: async () => ({ id: PROJECT_ID, name: 'Проект', workspaceId: 'ws' }) } as never,
    members: {
      listByProject: async () => MEMBERS,
      listApproverUserIdsForProject: async () => ['boss', 'lead'],
    } as never,
    tasks: { getById: async () => null } as never,
    email: {
      send: async (msg: { to: string }) => {
        sent.push(msg.to);
      },
    } as never,
    appUrl: 'https://pf.test',
  });
  return { svc, sent };
}

const task = { id: 't1', description: 'Задача', assignee: { userId: 'employee' } };

test('сотрудник меняет статус — письмо уходит только руководителям', async () => {
  const h = make();

  await h.svc.onStatusChanged(PROJECT_ID, 'employee', task, 'todo', 'done', 'team');

  assert.deepEqual(h.sent.sort(), ['boss@x', 'lead@x']);
});

test('коллега-сотрудник писем о чужой задаче не получает', async () => {
  const h = make();

  await h.svc.onStatusChanged(PROJECT_ID, 'employee', task, 'todo', 'done', 'team');

  assert.ok(!h.sent.includes('other@x'));
});

test('руководитель трогает задачу — ответственный узнаёт', async () => {
  const h = make();

  await h.svc.onStatusChanged(PROJECT_ID, 'boss', task, 'done', 'todo', 'team');

  assert.deepEqual(h.sent.sort(), ['employee@x', 'lead@x']);
});

test('создание задачи адресуется по тому же правилу', async () => {
  const h = make();

  await h.svc.onTaskCreated(PROJECT_ID, 'employee', task, 'team');

  assert.deepEqual(h.sent.sort(), ['boss@x', 'lead@x']);
});

test('события участников остаются общими: это не про задачу', async () => {
  const h = make();

  await h.svc.onMemberChanged(PROJECT_ID, 'employee', 'добавлен участник', 'team');

  assert.deepEqual(h.sent.sort(), ['boss@x', 'lead@x', 'other@x']);
});
