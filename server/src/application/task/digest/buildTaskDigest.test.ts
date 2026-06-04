import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TaskWithCounts } from '../ListTasks.js';
import {
  buildDigestModel,
  renderDigestText,
  renderDigestHtml,
  renderDigestMarkdownV2,
} from './buildTaskDigest.js';
import {
  taskNameFromDescription,
  formatDeadlineRu,
  escapeMarkdownV2,
} from '../../../domain/task/digestFormat.js';

function task(partial: Partial<TaskWithCounts> & { id: string }): TaskWithCounts {
  return {
    projectId: 'p1',
    description: null,
    status: 'todo',
    statusBeforeDone: null,
    position: 0,
    ralphMode: 'normal',
    ralphCancelRequestedAt: null,
    ralphCancelRequestedBy: null,
    ralphCancelRequestedByDisplayName: null,
    deadline: null,
    priority: null,
    createdAt: new Date('2026-06-01T00:00:00Z'),
    updatedAt: new Date('2026-06-01T00:00:00Z'),
    delegation: null,
    commitCount: 0,
    attachmentCount: 0,
    commentCount: 0,
    ...partial,
  };
}

const NOW = new Date(2026, 5, 4); // 2026-06-04 local

test('taskNameFromDescription: first non-empty line, markdown stripped, truncated', () => {
  assert.equal(taskNameFromDescription('# Починить **деплой** на прод'), 'Починить деплой на прод');
  assert.equal(taskNameFromDescription('\n\n- [тест](http://x) сделать'), 'тест сделать');
  assert.equal(taskNameFromDescription(''), '(без описания)');
  assert.equal(taskNameFromDescription(null), '(без описания)');
  const long = 'a'.repeat(200);
  const name = taskNameFromDescription(long);
  assert.ok(name.length <= 80);
  assert.ok(name.endsWith('…'));
});

test('formatDeadlineRu: relative for near, absolute otherwise', () => {
  assert.equal(formatDeadlineRu('2026-06-04', NOW), 'сегодня');
  assert.equal(formatDeadlineRu('2026-06-05', NOW), 'завтра');
  assert.equal(formatDeadlineRu('2026-06-03', NOW), 'вчера');
  // Абсолютная дата: ICU даёт сокращённый месяц (может быть «июн.» с точкой) —
  // проверяем содержательные части, не точное форматирование месяца.
  const sameYear = formatDeadlineRu('2026-06-20', NOW);
  assert.ok(sameYear.startsWith('20 ') && sameYear.includes('июн') && !sameYear.includes('2026'));
  const otherYear = formatDeadlineRu('2027-01-09', NOW);
  assert.ok(otherYear.startsWith('9 ') && otherYear.includes('янв') && otherYear.includes('2027'));
});

test('escapeMarkdownV2 escapes Telegram special chars', () => {
  assert.equal(escapeMarkdownV2('a.b-c!'), 'a\\.b\\-c\\!');
  assert.equal(escapeMarkdownV2('[x](y)'), '\\[x\\]\\(y\\)');
});

test('buildDigestModel: groups by priority in order, numbers within group', () => {
  const tasks = [
    task({ id: 't1', description: 'Низкая', priority: 4, position: 2 }),
    task({ id: 't2', description: 'Срочная B', priority: 1, position: 5 }),
    task({ id: 't3', description: 'Срочная A', priority: 1, position: 1 }),
    task({ id: 't4', description: 'Без приоритета' }),
  ];
  const m = buildDigestModel(tasks, {
    projectName: 'Сайт',
    appUrl: 'https://projectsflow.ru/',
    isInbox: false,
    now: NOW,
  });
  assert.equal(m.count, 4);
  // Группы: P1, P4, без приоритета (P2/P3 пустые — пропущены).
  assert.deepEqual(
    m.groups.map((g) => g.priority),
    [1, 4, null],
  );
  // Внутри P1 сортировка по position: «Срочная A» (pos 1) раньше «Срочная B» (pos 5).
  assert.deepEqual(
    m.groups[0]!.items.map((i) => i.name),
    ['Срочная A', 'Срочная B'],
  );
  // Ссылка без хвостового слэша базы, формат /projects/:id?task=:id.
  assert.equal(m.groups[0]!.items[0]!.link, 'https://projectsflow.ru/projects/p1?task=t3');
});

test('buildDigestModel: inbox links go to /inbox; assignee from delegation', () => {
  const tasks = [
    task({
      id: 't1',
      description: 'Делегированная',
      priority: 2,
      deadline: '2026-06-05',
      delegation: {
        id: 'd1',
        taskId: 't1',
        delegateUserId: 'u2',
        delegateDisplayName: 'Анна',
        creatorUserId: 'u1',
        creatorDisplayName: 'Я',
        status: 'pending',
        createdAt: new Date('2026-06-01T00:00:00Z'),
        respondedAt: null,
      },
    }),
  ];
  const m = buildDigestModel(tasks, {
    projectName: 'Inbox',
    appUrl: 'https://projectsflow.ru',
    isInbox: true,
    now: NOW,
  });
  const it = m.groups[0]!.items[0]!;
  assert.equal(it.link, 'https://projectsflow.ru/inbox?task=t1');
  assert.equal(it.assignee, 'Анна');
  assert.equal(it.deadline, 'завтра');
});

test('renderDigestText: header, group heading, numbered items, meta line', () => {
  const tasks = [task({ id: 't1', description: 'Починить деплой', priority: 1, deadline: '2026-06-20' })];
  const m = buildDigestModel(tasks, { projectName: 'Сайт', appUrl: 'https://x.ru', isInbox: false, now: NOW });
  const txt = renderDigestText(m);
  assert.ok(txt.startsWith('Задачи — 1 · Проект «Сайт»'));
  assert.ok(txt.includes('🔴 P1 · Срочно'));
  assert.ok(txt.includes('1. Починить деплой'));
  assert.ok(txt.includes('⏰ 20 июн'));
  assert.ok(txt.includes('🔗 https://x.ru/projects/p1?task=t1'));
});

test('renderDigestHtml: escapes and builds ordered list with links', () => {
  const tasks = [task({ id: 't1', description: 'A & B <script>', priority: 1 })];
  const m = buildDigestModel(tasks, { projectName: 'P<>', appUrl: 'https://x.ru', isInbox: false, now: NOW });
  const html = renderDigestHtml(m);
  assert.ok(html.includes('A &amp; B &lt;script&gt;'));
  assert.ok(html.includes('P&lt;&gt;'));
  assert.ok(html.includes('<ol'));
  assert.ok(html.includes('<a href="https://x.ru/projects/p1?task=t1"'));
});

test('renderDigestMarkdownV2: escapes special chars, dots in numbering escaped', () => {
  const tasks = [task({ id: 't1', description: 'Fix bug.', priority: 1 })];
  const m = buildDigestModel(tasks, { projectName: 'Сайт', appUrl: 'https://x.ru', isInbox: false, now: NOW });
  const md = renderDigestMarkdownV2(m);
  assert.ok(md.includes('1\\.')); // номер с экранированной точкой
  assert.ok(md.includes('Fix bug\\.')); // точка в имени экранирована
  assert.ok(md.includes('[открыть](https://x.ru/projects/p1?task=t1)'));
});
