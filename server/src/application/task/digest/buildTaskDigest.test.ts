import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TaskWithCounts } from '../ListTasks.js';
import {
  buildDigestModel,
  renderDigestMarkdown,
  renderDigestHtml,
  renderDigestRich,
  renderDigestTelegram,
  telegramDigestTaskTitle,
  type DigestAttachment,
} from './buildTaskDigest.js';
import {
  splitDescription,
  priorityHeading,
  formatDeadlineRu,
  formatDeadlineRemainingRu,
  markdownToRich,
} from '../../../domain/task/digestFormat.js';

function task(partial: Partial<TaskWithCounts> & { id: string }): TaskWithCounts {
  return {
    projectId: 'p1',
    createdBy: 'u1',
    assignee: { userId: 'u1', displayName: 'Я', avatarUrl: null },
    description: null,
    icon: null,
    cover: null,
    coverPosition: 50,
    status: 'todo',
    statusBeforeDone: null,
    position: 0,
    ralphMode: 'normal',
    ralphCancelRequestedAt: null,
    ralphCancelRequestedBy: null,
    ralphCancelRequestedByDisplayName: null,
    deadline: null,
    startDate: null,
    parentTaskId: null,
    priority: null,
    createdAt: new Date('2026-06-01T00:00:00Z'),
    updatedAt: new Date('2026-06-01T00:00:00Z'),
    commitCount: 0,
    attachmentCount: 0,
    commentCount: 0,
    ...partial,
  };
}

const NOW = new Date(2026, 5, 4); // 2026-06-04 local
const noAtt = new Map<string, DigestAttachment[]>();
const baseOpts = {
  projectName: 'Сайт',
  appUrl: 'https://projectsflow.ru',
  isInbox: false,
  attachmentsByTask: noAtt,
  now: NOW,
};

test('splitDescription: name=first line (stripped), body=rest', () => {
  const { name, body } = splitDescription('# Починить **деплой**\nдетали\nещё детали');
  assert.equal(name, 'Починить деплой');
  assert.equal(body, 'детали\nещё детали');
  assert.deepEqual(splitDescription(null), { name: '(без описания)', body: '' });
  assert.deepEqual(splitDescription('одна строка'), { name: 'одна строка', body: '' });
  // Полный текст не обрезается (фидбэк): длинная первая строка — целиком в анкоре.
  assert.equal(splitDescription('a'.repeat(200)).name.length, 200);
});

test('priorityHeading: «Приоритет: X» с эмодзи / «Без приоритета»', () => {
  assert.equal(priorityHeading(2), '🟠 Приоритет: Высокий');
  assert.equal(priorityHeading(4), '⚪ Приоритет: Низкий');
  assert.equal(priorityHeading(null), 'Без приоритета');
});

test('formatDeadlineRu: relative for near, absolute otherwise', () => {
  assert.equal(formatDeadlineRu('2026-06-04', NOW), 'сегодня');
  assert.equal(formatDeadlineRu('2026-06-05', NOW), 'завтра');
  const sameYear = formatDeadlineRu('2026-06-20', NOW);
  assert.ok(sameYear.startsWith('20 ') && sameYear.includes('июн') && !sameYear.includes('2026'));
});

test('formatDeadlineRemainingRu: shows remaining or overdue calendar days', () => {
  assert.equal(formatDeadlineRemainingRu('2026-06-04', NOW), 'истекает сегодня');
  assert.equal(formatDeadlineRemainingRu('2026-06-05', NOW), 'остался 1 день');
  assert.equal(formatDeadlineRemainingRu('2026-06-07', NOW), 'осталось 3 дня');
  assert.equal(formatDeadlineRemainingRu('2026-06-20', NOW), 'осталось 16 дней');
  assert.equal(formatDeadlineRemainingRu('2026-05-31', NOW), 'просрочено на 4 дня');
  assert.equal(formatDeadlineRemainingRu('2026-05-24', NOW), 'просрочено на 11 дней');
});

test('markdownToRich telegram: escapes text, balanced inline tags only', () => {
  const out = markdownToRich('Fix <bug> & **bold** `code` [x](http://y)', 'telegram');
  assert.ok(out.includes('Fix &lt;bug&gt; &amp;'));
  assert.ok(out.includes('<b>bold</b>'));
  assert.ok(out.includes('<code>code</code>'));
  assert.ok(out.includes('<a href="http://y">x</a>'));
  // нет блочных тегов
  assert.ok(!out.includes('<p') && !out.includes('<ul'));
});

test('markdownToRich email: headings→bold, bullets→<ul>', () => {
  const out = markdownToRich('## Шаги\n- раз\n- два', 'email');
  assert.ok(out.includes('font-weight:600">Шаги</p>'));
  assert.ok(out.includes('<ul'));
  assert.ok(out.includes('<li>раз</li>'));
  assert.ok(out.includes('<li>два</li>'));
});

test('markdownToRich telegram: strike / underline / quote', () => {
  const out = markdownToRich('~~старое~~ <u>важно</u>\n> цитата', 'telegram');
  assert.ok(out.includes('<s>старое</s>'));
  assert.ok(out.includes('<u>важно</u>'));
  assert.ok(out.includes('<blockquote>цитата</blockquote>'));
  // содержимое <u> не должно «протекать» сырым html
  assert.ok(!out.includes('<script'));
});

test('markdownToRich email: quote → styled blockquote', () => {
  const out = markdownToRich('> цитата', 'email');
  assert.ok(out.includes('<blockquote') && out.includes('цитата</blockquote>'));
});

test('buildDigestModel: groups by priority; no-priority sorted by createdAt asc', () => {
  const tasks = [
    task({ id: 't1', description: 'Новая без приоритета', createdAt: new Date('2026-06-03T00:00:00Z') }),
    task({ id: 't2', description: 'Срочная B', priority: 1, position: 5 }),
    task({ id: 't3', description: 'Срочная A', priority: 1, position: 1 }),
    task({ id: 't4', description: 'Старая без приоритета', createdAt: new Date('2026-06-01T00:00:00Z') }),
  ];
  const m = buildDigestModel(tasks, baseOpts);
  assert.equal(m.count, 4);
  assert.deepEqual(m.groups.map((g) => g.priority), [1, null]);
  assert.equal(m.groups[0]!.heading, '🔴 Приоритет: Срочно');
  // P1: по position
  assert.deepEqual(m.groups[0]!.items.map((i) => i.name), ['Срочная A', 'Срочная B']);
  // без приоритета: старая (06-01) №1, новая (06-03) №2
  assert.deepEqual(m.groups[1]!.items.map((i) => i.name), ['Старая без приоритета', 'Новая без приоритета']);
  // ссылки: open + done
  assert.equal(m.groups[0]!.items[0]!.openLink, 'https://projectsflow.ru/projects/p1?task=t3');
  assert.equal(m.groups[0]!.items[0]!.doneLink, 'https://projectsflow.ru/projects/p1?task=t3&done=1');
});

test('buildDigestModel: inbox links + assignee + attachments', () => {
  const att = new Map<string, DigestAttachment[]>([
    ['t1', [{ name: 'лог.png', url: 'https://x/api/attachments/a1' }]],
  ]);
  const tasks = [
    task({
      id: 't1',
      description: 'Назначенная',
      priority: 2,
      assignee: { userId: 'u2', displayName: 'Анна', avatarUrl: null },
    }),
  ];
  const m = buildDigestModel(tasks, { ...baseOpts, isInbox: true, attachmentsByTask: att });
  const it = m.groups[0]!.items[0]!;
  assert.equal(it.openLink, 'https://projectsflow.ru/inbox?task=t1');
  assert.equal(it.assignee, 'Анна');
  assert.deepEqual(it.attachments, [{ name: 'лог.png', url: 'https://x/api/attachments/a1' }]);
});

test('telegramDigestTaskTitle: keeps one compact sentence', () => {
  assert.equal(
    telegramDigestTaskTitle('Проверить отчёт. Затем отправить заказчику.'),
    'Проверить отчёт.',
  );
  assert.equal(telegramDigestTaskTitle('a'.repeat(120)).length, 96);
});

test('renderDigestMarkdown: bold header, anchor + done link, body, attachments', () => {
  const att = new Map<string, DigestAttachment[]>([['t1', [{ name: 'f.pdf', url: 'https://x/a/1' }]]]);
  const tasks = [task({ id: 't1', description: 'Заголовок\nтело задачи', priority: 1, deadline: '2026-06-20' })];
  const md = renderDigestMarkdown(buildDigestModel(tasks, { ...baseOpts, attachmentsByTask: att }));
  assert.ok(md.startsWith('**Задачи — 1 · Проект «'));
  assert.ok(md.includes('**🔴 Приоритет: Срочно**'));
  assert.ok(md.includes('1. **[Заголовок](https://projectsflow.ru/projects/p1?task=t1)** · [✓ Готово](https://projectsflow.ru/projects/p1?task=t1&done=1)'));
  assert.ok(md.includes('тело задачи'));
  assert.ok(md.includes('осталось 16 дней'));
  assert.ok(md.includes('📎 [f.pdf](https://x/a/1)'));
});

test('renderDigestTelegram: plain fallback hides a short title with icon actions', () => {
  const tasks = [task({ id: 't1', description: 'A & <b> тест. Лишние подробности.\nПолное тело', priority: 1, commentCount: 3 })];
  const chunks = renderDigestTelegram(buildDigestModel(tasks, baseOpts));
  assert.equal(chunks.length, 1);
  const tg = chunks[0]!;
  assert.ok(tg.startsWith('<b>Задачи — 1 · '));
  assert.ok(tg.includes('<blockquote expandable>'));
  assert.ok(tg.endsWith('</blockquote>'));
  assert.ok(tg.includes('<b>A &amp; &lt;b&gt; тест.</b>'));
  assert.ok(!tg.includes('Лишние подробности'));
  assert.ok(!tg.includes('Полное тело'));
  assert.ok(tg.includes('>✓</a>'));
  assert.ok(tg.includes('>↗</a>'));
  assert.ok(!tg.includes('Комментировать'));
  assert.ok(!tg.includes('Завершить'));
});

test('renderDigestRich: hides the original table and keeps compact icon actions in each task cell', () => {
  const tasks = [task({ id: 't1', description: 'Проверить отчёт', priority: 1, deadline: '2026-06-07' })];
  const rich = renderDigestRich(buildDigestModel(tasks, baseOpts));

  assert.ok(rich.includes('<table bordered striped>'));
  assert.ok(rich.includes('<tr><th>Задача</th><th>Кто</th><th>Дедлайн</th></tr>'));
  assert.ok(rich.includes('<details><summary>Показать задачи (1)</summary>'));
  assert.ok(rich.endsWith('</details>'));
  assert.ok(rich.includes('<b>Проверить отчёт</b>'));
  assert.ok(!rich.includes('<a href="https://projectsflow.ru/projects/p1?task=t1"><b>'));
  assert.ok(rich.includes('<a href="https://projectsflow.ru/projects/p1?task=t1&amp;done=1">✓</a>'));
  assert.ok(rich.includes('<a href="https://projectsflow.ru/projects/p1?task=t1">↗</a>'));
  assert.ok(!rich.includes('Завершить') && !rich.includes('Перейти'));
  assert.ok(rich.includes('<td>Я</td>'));
  assert.ok(rich.includes('>осталось 3 дня</td>'));
});

test('renderDigestTelegram: длинная сводка → несколько сообщений, все задачи целиком', () => {
  const many = Array.from({ length: 40 }, (_, i) =>
    task({ id: `t${i}`, description: `Задача ${i} ` + 'x'.repeat(150), priority: 2 }),
  );
  const chunks = renderDigestTelegram(buildDigestModel(many, baseOpts), { maxLen: 1000 });
  assert.ok(chunks.length > 1, 'разбито на несколько сообщений');
  for (const c of chunks) assert.ok(c.length <= 1000, `чанк длиной ${c.length} <= 1000`);
  const joined = chunks.join('\n');
  assert.ok(joined.includes('Задача 0') && joined.includes('Задача 39'), 'все задачи показаны');
  assert.ok(!joined.includes('полностью на сайте'), 'обрезки нет');
});

test('renderDigestTelegram: fallback uses the same textless actions as the rich table', () => {
  const tasks = [task({ id: 't1', description: 'Задача', priority: 1, commentCount: 0 })];
  const tg = renderDigestTelegram(buildDigestModel(tasks, baseOpts))[0]!;
  assert.ok(tg.includes('<b>Задача</b>'));
  assert.ok(!tg.includes('Комментировать'));
  assert.ok(tg.includes('>✓</a>'));
  assert.ok(tg.includes('>↗</a>'));
  assert.ok(!tg.includes('Завершить') && !tg.includes('Перейти'));
});

test('status grouping: groups by visible column; in_progress folds into «Воркер»', () => {
  const tasks = [
    task({ id: 't1', description: 'В черновике', status: 'backlog', position: 1 }),
    task({ id: 't2', description: 'В работе', status: 'in_progress', position: 1 }),
    task({ id: 't3', description: 'Воркер ждёт', status: 'todo', position: 2 }),
  ];
  const m = buildDigestModel(tasks, { ...baseOpts, grouping: { by: 'status', statuses: ['backlog', 'todo'] } });
  assert.deepEqual(m.groups.map((g) => g.heading), ['Черновики', 'Воркер']);
  // in_progress сворачивается в «Воркер» вместе с todo (сорт по position).
  assert.deepEqual(m.groups[1]!.items.map((i) => i.name), ['В работе', 'Воркер ждёт']);
});

test('assignee grouping: one group per responsible person with Telegram mention', () => {
  const tasks = [
    task({
      id: 't1', description: 'Задача Бориса', position: 2,
      assignee: { userId: 'u2', displayName: 'Борис', avatarUrl: null },
    }),
    task({
      id: 't2', description: 'Задача Анны', position: 1,
      assignee: { userId: 'u1', displayName: 'Анна', avatarUrl: null },
    }),
    task({
      id: 't3', description: 'Вторая Бориса', position: 1,
      assignee: { userId: 'u2', displayName: 'Борис', avatarUrl: null },
    }),
  ];
  const m = buildDigestModel(tasks, {
    ...baseOpts,
    grouping: { by: 'assignee' },
    telegramAssignees: new Map([
      ['u1', { telegramUserId: 101, username: 'anna_pf' }],
      ['u2', { telegramUserId: 202, username: null }],
    ]),
  });

  assert.deepEqual(m.groups.map((group) => group.heading), ['Анна', 'Борис']);
  assert.deepEqual(m.groups[1]!.items.map((item) => item.name), ['Вторая Бориса', 'Задача Бориса']);
  const rich = renderDigestRich(m);
  assert.ok(rich.includes('@anna_pf · Анна'));
  assert.ok(rich.includes('<a href="tg://user?id=202">Борис</a>'));
});

test('renderDigestTelegram: compact fallback omits per-task metadata', () => {
  const tasks = [
    task({
      id: 't1', description: 'Задача', priority: 1,
      assignee: { userId: 'u', displayName: 'Борис', avatarUrl: null },
    }),
    task({ id: 't2', description: 'Ничья', priority: 1 }),
  ];
  const tg = renderDigestTelegram(buildDigestModel(tasks, baseOpts))[0]!;
  assert.ok(!tg.includes('👤 Борис'));
  assert.ok(!tg.includes('👤 Я'));
  assert.ok(tg.includes('<b>Задача</b>'));
  assert.ok(tg.includes('<b>Ничья</b>'));
  assert.equal((tg.match(/>✓<\/a>/g) ?? []).length, 2);
  assert.equal((tg.match(/>↗<\/a>/g) ?? []).length, 2);
});

test('renderDigestHtml: жирный заголовок (не ссылка) + кнопки Комментировать/Завершить внизу', () => {
  const tasks = [task({ id: 't1', description: 'A & B <x>', priority: 1, commentCount: 2 })];
  const html = renderDigestHtml(buildDigestModel(tasks, baseOpts));
  // заголовок экранирован, жирный и НЕ обёрнут в ссылку
  assert.ok(html.includes('A &amp; B &lt;x&gt;'));
  assert.ok(!html.includes('<a href="https://projectsflow.ru/projects/p1?task=t1">A'));
  // кнопки внизу: Комментировать (2) → openLink, Завершить → doneLink
  assert.ok(html.includes('href="https://projectsflow.ru/projects/p1?task=t1"'));
  assert.ok(html.includes('💬 Комментировать (2)'));
  assert.ok(html.includes('href="https://projectsflow.ru/projects/p1?task=t1&amp;done=1"'));
  assert.ok(html.includes('✓ Завершить'));
  // старого «✓ Готово» сбоку больше нет
  assert.ok(!html.includes('✓ Готово'));
});

test('renderDigestHtml: commentCount 0 → «Комментировать» без «(0)»', () => {
  const tasks = [task({ id: 't1', description: 'Задача', priority: 1, commentCount: 0 })];
  const html = renderDigestHtml(buildDigestModel(tasks, baseOpts));
  assert.ok(html.includes('💬 Комментировать</a>'));
  assert.ok(!html.includes('Комментировать ('));
});
