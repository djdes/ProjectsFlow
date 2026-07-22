import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAssigneeMenu,
  buildAssigneeTaskCards,
  resolveAssigneeByName,
  ASSIGNEE_CARDS_LIMIT,
  type AssigneeBrowseDeps,
} from './assigneeBrowse.js';

// Мини-фейки над узкими Pick-портами (конвенция репо: ручные in-memory стабы, без mock-библиотек).
type Seed = {
  projects?: { id: string; name: string }[];
  tasksByProject?: Record<string, TaskSeed[]>;
};
type TaskSeed = {
  id: string;
  description: string | null;
  status?: string;
  deadline?: string | null;
  assigneeUserId?: string;
  assigneeDisplayName?: string;
};

function makeDeps(seed: Seed): AssigneeBrowseDeps {
  return {
    members: {
      async listProjectsForUser() {
        return (seed.projects ?? []) as never;
      },
    },
    tasks: {
      async listByProject(projectId: string) {
        return (seed.tasksByProject?.[projectId] ?? []).map((t) => ({
          status: 'todo',
          deadline: null,
          ...t,
          assignee: {
            userId: t.assigneeUserId ?? 'viewer',
            displayName: t.assigneeDisplayName ?? 'Я',
            avatarUrl: null,
          },
        })) as never;
      },
    },
  };
}

// Все кнопки клавиатуры плоским списком — для удобных assert'ов.
function flatButtons(kb: { inline_keyboard: ReadonlyArray<ReadonlyArray<{ text: string; callback_data?: string; url?: string }>> }) {
  return kb.inline_keyboard.flat();
}

test('menu: группировка по ответственному, счётчики, ba:-callback', async () => {
  const deps = makeDeps({
    projects: [{ id: 'p1', name: 'Сайт' }, { id: 'p2', name: 'Бот' }],
    tasksByProject: {
      p1: [
        { id: 't1', description: 'Задача 1', assigneeUserId: 'u-oleg', assigneeDisplayName: 'Олег' },
        { id: 't2', description: 'Задача 2', assigneeUserId: 'u-vera', assigneeDisplayName: 'Вера' },
      ],
      p2: [{ id: 't3', description: 'Задача 3', assigneeUserId: 'u-oleg', assigneeDisplayName: 'Олег' }],
    },
  });
  const menu = await buildAssigneeMenu(deps, 'viewer');
  assert.ok(menu);
  const buttons = flatButtons(menu.keyboard);
  const oleg = buttons.find((b) => b.callback_data === 'ba:u-oleg');
  assert.ok(oleg, 'кнопка ответственного есть');
  assert.equal(oleg.text, '👤 Олег (2)');
  const vera = buttons.find((b) => b.callback_data === 'ba:u-vera');
  assert.ok(vera, 'кнопка второго ответственного есть');
  assert.equal(vera.text, '👤 Вера (1)');
  assert.ok(!buttons.some((b) => b.callback_data === 'ba:none'));
  assert.ok(buttons.some((b) => b.callback_data === 'bt:root'), 'кнопка «По проектам» есть');
  assert.ok(menu.text.includes('ответственным'));
});

test('menu: done-задачи не считаются', async () => {
  const deps = makeDeps({
    projects: [{ id: 'p1', name: 'Сайт' }],
    tasksByProject: {
      p1: [
        { id: 't1', description: 'Открытая' },
        { id: 't2', description: 'Готовая', status: 'done' },
      ],
    },
  });
  const menu = await buildAssigneeMenu(deps, 'viewer');
  assert.ok(menu);
  const buttons = flatButtons(menu.keyboard);
  const mine = buttons.find((b) => b.callback_data === 'ba:viewer');
  assert.ok(mine);
  assert.equal(mine.text, '👤 Я (1)', 'done не посчитан');
  assert.ok(!buttons.some((b) => b.callback_data === 'ba:none'));
});

test('menu: нет проектов → null', async () => {
  const menu = await buildAssigneeMenu(makeDeps({}), 'viewer');
  assert.equal(menu, null);
});

test('menu: проекты есть, открытых задач нет → текст-пустышка + только «По проектам»', async () => {
  const deps = makeDeps({
    projects: [{ id: 'p1', name: 'Сайт' }],
    tasksByProject: { p1: [{ id: 't1', description: 'x', status: 'done' }] },
  });
  const menu = await buildAssigneeMenu(deps, 'viewer');
  assert.ok(menu);
  const buttons = flatButtons(menu.keyboard);
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0]!.callback_data, 'bt:root');
  assert.ok(menu.text.includes('нет'));
});

test('cards: фильтр по ответственному, plain-название (не markdown), проект, url-кнопка ?task=', async () => {
  const deps = makeDeps({
    projects: [{ id: 'p1', name: 'Сайт' }],
    tasksByProject: {
      p1: [
        {
          id: 't1',
          description: '## **Починить** [парсер](https://x)\n\nдлинное описание тела',
          assigneeUserId: 'u-oleg',
          assigneeDisplayName: 'Олег',
        },
        { id: 't2', description: 'Чужая задача', assigneeUserId: 'u-vera', assigneeDisplayName: 'Вера' },
      ],
    },
  });
  const res = await buildAssigneeTaskCards(deps, 'viewer', 'u-oleg', 'https://pf.test/');
  assert.equal(res.totalCount, 1);
  assert.equal(res.assigneeName, 'Олег');
  assert.equal(res.cards.length, 1);
  const card = res.cards[0]!;
  assert.equal(card.taskId, 't1');
  assert.equal(card.projectId, 'p1');
  assert.ok(card.text.includes('Починить парсер'), 'название — plain, markdown снят');
  assert.ok(!card.text.includes('**'), 'без сырой разметки');
  assert.ok(!card.text.includes('длинное описание тела'), 'тело описания не тянем');
  assert.ok(card.text.includes('Сайт'), 'проект в карточке');
  const buttons = card.keyboard.inline_keyboard.flat();
  assert.ok(buttons.some((b) => b.callback_data === 'nd:t1'), '✅ Завершить');
  assert.ok(buttons.some((b) => b.callback_data === 'nc:t1'), '💬 Комментировать');
  assert.ok(buttons.some((b) => b.callback_data === 'bt:t:t1'), '👁 Открыть в Telegram');
  const urlBtn = buttons.find((b) => b.url !== undefined);
  assert.ok(urlBtn, 'url-кнопка есть');
  assert.equal(urlBtn.url, 'https://pf.test/projects/p1?task=t1');
  assert.equal(urlBtn.text, 'Открыть в ProjectsFlow');
});

test('cards: неизвестный ответственный → пустой список', async () => {
  const deps = makeDeps({
    projects: [{ id: 'p1', name: 'Сайт' }],
    tasksByProject: { p1: [{ id: 't1', description: 'Своя' }] },
  });
  const res = await buildAssigneeTaskCards(deps, 'viewer', 'missing-user', 'https://pf.test');
  assert.equal(res.assigneeName, null);
  assert.equal(res.totalCount, 0);
  assert.equal(res.cards.length, 0);
});

test('cards: сортировка просроченные → по сроку → без срока; пометка «просрочено»', async () => {
  const now = new Date(2026, 6, 13); // 13 июля 2026 (месяцы 0-based)
  const deps = makeDeps({
    projects: [{ id: 'p1', name: 'Сайт' }],
    tasksByProject: {
      p1: [
        { id: 't-nodl', description: 'Без срока' },
        { id: 't-future', description: 'Будущая', deadline: '2026-07-20' },
        { id: 't-over', description: 'Просроченная', deadline: '2026-07-01' },
        { id: 't-today', description: 'Сегодня', deadline: '2026-07-13' },
      ],
    },
  });
  const res = await buildAssigneeTaskCards(deps, 'viewer', 'viewer', 'https://pf.test', now);
  assert.deepEqual(
    res.cards.map((c) => c.taskId),
    ['t-over', 't-today', 't-future', 't-nodl'],
  );
  assert.ok(res.cards[0]!.text.includes('просрочено'), 'у просроченной есть пометка');
  assert.ok(!res.cards[1]!.text.includes('просрочено'), 'сегодняшняя не просрочена');
  assert.ok(res.cards[1]!.text.includes('сегодня'), 'formatDeadlineRu применён');
  assert.ok(!res.cards[3]!.text.includes('⏰'), 'без срока — без строки ⏰');
});

test('cards: лимит 12, totalCount — полный', async () => {
  const many = Array.from({ length: 15 }, (_, i) => ({
    id: `t${i}`,
    description: `Задача ${i}`,
  }));
  const deps = makeDeps({
    projects: [{ id: 'p1', name: 'Сайт' }],
    tasksByProject: { p1: many },
  });
  const res = await buildAssigneeTaskCards(deps, 'viewer', 'viewer', 'https://pf.test');
  assert.equal(res.cards.length, ASSIGNEE_CARDS_LIMIT);
  assert.equal(res.totalCount, 15);
});

// --- resolveAssigneeByName («@Человек» из TG → ответственный по открытым задачам) ---

const resolveSeed: Seed = {
  projects: [{ id: 'p1', name: 'Сайт' }],
  tasksByProject: {
    p1: [
      { id: 't1', description: 'A', assigneeUserId: 'u-oleg', assigneeDisplayName: 'Олег Петров' },
      { id: 't2', description: 'B', assigneeUserId: 'u-oleg', assigneeDisplayName: 'Олег Петров' },
      { id: 't3', description: 'C', assigneeUserId: 'u-olga', assigneeDisplayName: 'Ольга Сидорова' },
    ],
  },
};

test('resolve: точный/префиксный матч по displayName → ok', async () => {
  const res = await resolveAssigneeByName(makeDeps(resolveSeed), 'viewer', 'Олег');
  assert.equal(res.kind, 'ok');
  if (res.kind === 'ok') {
    assert.equal(res.assigneeUserId, 'u-oleg');
    assert.equal(res.assigneeName, 'Олег Петров');
  }
});

test('resolve: неоднозначность (substring «Ол» → Олег и Ольга) → ambiguous с опциями', async () => {
  const res = await resolveAssigneeByName(makeDeps(resolveSeed), 'viewer', 'Ол');
  assert.equal(res.kind, 'ambiguous');
  if (res.kind === 'ambiguous') {
    const ids = res.options.map((o) => o.userId).sort();
    assert.deepEqual(ids, ['u-oleg', 'u-olga']);
    assert.equal(res.options.find((o) => o.userId === 'u-oleg')?.count, 2);
  }
});

test('resolve: нет совпадения → none', async () => {
  const res = await resolveAssigneeByName(makeDeps(resolveSeed), 'viewer', 'Вася');
  assert.equal(res.kind, 'none');
});

test('resolve: нет проектов/открытых задач → no_projects', async () => {
  const empty = await resolveAssigneeByName(makeDeps({}), 'viewer', 'Олег');
  assert.equal(empty.kind, 'no_projects');
  const doneOnly = await resolveAssigneeByName(
    makeDeps({ projects: [{ id: 'p1', name: 'X' }], tasksByProject: { p1: [{ id: 't', description: 'x', status: 'done' }] } }),
    'viewer',
    'Олег',
  );
  assert.equal(doneOnly.kind, 'no_projects');
});

test('resolve: пустой query (@ без имени) → ambiguous со всеми', async () => {
  const res = await resolveAssigneeByName(makeDeps(resolveSeed), 'viewer', '');
  assert.equal(res.kind, 'ambiguous');
  if (res.kind === 'ambiguous') assert.equal(res.options.length, 2);
});
