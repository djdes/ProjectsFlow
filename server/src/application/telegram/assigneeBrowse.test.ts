import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAssigneeMenu,
  buildAssigneeTaskCards,
  ASSIGNEE_CARDS_LIMIT,
  type AssigneeBrowseDeps,
} from './assigneeBrowse.js';

// Мини-фейки над узкими Pick-портами (конвенция репо: ручные in-memory стабы, без mock-библиотек).
type Seed = {
  projects?: { id: string; name: string }[];
  tasksByProject?: Record<string, TaskSeed[]>;
  // taskId → делегат активной делегации; отсутствие ключа = без делегации.
  delegations?: Record<string, { delegateUserId: string; delegateDisplayName: string }>;
};
type TaskSeed = {
  id: string;
  description: string | null;
  status?: string;
  deadline?: string | null;
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
        })) as never;
      },
    },
    delegations: {
      async listActiveForTasks(taskIds: readonly string[]) {
        const m = new Map();
        for (const id of taskIds) {
          const d = seed.delegations?.[id];
          if (d) m.set(id, { id: `d-${id}`, taskId: id, status: 'accepted', ...d });
        }
        return m as never;
      },
    },
  };
}

// Все кнопки клавиатуры плоским списком — для удобных assert'ов.
function flatButtons(kb: { inline_keyboard: ReadonlyArray<ReadonlyArray<{ text: string; callback_data?: string; url?: string }>> }) {
  return kb.inline_keyboard.flat();
}

test('menu: группировка по делегату, счётчики, ba:-callback', async () => {
  const deps = makeDeps({
    projects: [{ id: 'p1', name: 'Сайт' }, { id: 'p2', name: 'Бот' }],
    tasksByProject: {
      p1: [{ id: 't1', description: 'Задача 1' }, { id: 't2', description: 'Задача 2' }],
      p2: [{ id: 't3', description: 'Задача 3' }],
    },
    delegations: {
      t1: { delegateUserId: 'u-oleg', delegateDisplayName: 'Олег' },
      t3: { delegateUserId: 'u-oleg', delegateDisplayName: 'Олег' },
    },
  });
  const menu = await buildAssigneeMenu(deps, 'viewer');
  assert.ok(menu);
  const buttons = flatButtons(menu.keyboard);
  const oleg = buttons.find((b) => b.callback_data === 'ba:u-oleg');
  assert.ok(oleg, 'кнопка ответственного есть');
  assert.equal(oleg.text, '👤 Олег (2)');
  const none = buttons.find((b) => b.callback_data === 'ba:none');
  assert.ok(none, 'кнопка «Без ответственного» есть');
  assert.ok(none.text.includes('Без ответственного (1)'));
  assert.ok(buttons.some((b) => b.callback_data === 'bt:root'), 'кнопка «По проектам» есть');
  assert.ok(menu.text.includes('ответственным'));
});

test('menu: done-задачи не считаются; без делегаций — только «Без ответственного»', async () => {
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
  assert.ok(!buttons.some((b) => (b.callback_data ?? '').startsWith('ba:') && b.callback_data !== 'ba:none'));
  const none = buttons.find((b) => b.callback_data === 'ba:none');
  assert.ok(none);
  assert.ok(none.text.includes('(1)'), 'done не посчитан');
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

test('cards: фильтр по делегату, plain-название (не markdown), проект, url-кнопка ?task=', async () => {
  const deps = makeDeps({
    projects: [{ id: 'p1', name: 'Сайт' }],
    tasksByProject: {
      p1: [
        { id: 't1', description: '## **Починить** [парсер](https://x)\n\nдлинное описание тела' },
        { id: 't2', description: 'Чужая задача' },
      ],
    },
    delegations: {
      t1: { delegateUserId: 'u-oleg', delegateDisplayName: 'Олег' },
      t2: { delegateUserId: 'u-vera', delegateDisplayName: 'Вера' },
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
  const urlBtn = buttons.find((b) => b.url !== undefined);
  assert.ok(urlBtn, 'url-кнопка есть');
  assert.equal(urlBtn.url, 'https://pf.test/projects/p1?task=t1');
  assert.equal(urlBtn.text, 'Открыть в ProjectsFlow');
});

test('cards: ba:none (assigneeUserId=null) → только задачи без делегации', async () => {
  const deps = makeDeps({
    projects: [{ id: 'p1', name: 'Сайт' }],
    tasksByProject: { p1: [{ id: 't1', description: 'Своя' }, { id: 't2', description: 'Делегирована' }] },
    delegations: { t2: { delegateUserId: 'u-x', delegateDisplayName: 'X' } },
  });
  const res = await buildAssigneeTaskCards(deps, 'viewer', null, 'https://pf.test');
  assert.equal(res.assigneeName, null);
  assert.equal(res.cards.length, 1);
  assert.equal(res.cards[0]!.taskId, 't1');
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
  const res = await buildAssigneeTaskCards(deps, 'viewer', null, 'https://pf.test', now);
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
  const res = await buildAssigneeTaskCards(deps, 'viewer', null, 'https://pf.test');
  assert.equal(res.cards.length, ASSIGNEE_CARDS_LIMIT);
  assert.equal(res.totalCount, 15);
});
