// Smoke scenarios. Each entry runs once per [viewport, theme] pair of its `matrix`, every
// time in a fresh browser context with a fresh fixture state (see fixtures.mjs).
//
// A scenario gets `t` (CaseRun from run.mjs):
//   t.page, t.state (fixture data), t.journal (mutations / unknown endpoints),
//   t.isMobile, t.theme ('light' | 'dark'),
//   t.goto(path, { ready })  — hard step: navigation + a locator that must become visible,
//   t.step(name, fn)         — hard check (failure stops the scenario),
//   t.check(name, fn)        — soft check (failure is recorded, the scenario goes on);
//                              resolves to true/false so dependent checks can be skipped,
//   t.skip(name, reason)     — a dependent check that was not run,
//   t.expected(name, reason) — a check waiting for the app (shown, does not fail the run),
//   t.pageChecks(label)      — no error screen, no horizontal overflow, phone bottom nav,
//   t.boxFitsCheck(label, selector) — a dialog/sheet fits the screen horizontally,
//   t.visible / t.hidden / t.waitFor / t.assert / t.waitForMutation — helpers.

import { BOARD_PROJECT_ID, ME, WORKSPACE_ID, firstLine } from './fixtures.mjs';

export const VIEWPORTS = {
  desktop: { label: 'десктоп 1440×900', viewport: { width: 1440, height: 900 } },
  phone: {
    label: 'телефон 390×844',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  },
  narrow: {
    label: 'узкий телефон 320×640',
    viewport: { width: 320, height: 640 },
    isMobile: true,
    hasTouch: true,
  },
};

export const THEMES = {
  light: { label: 'светлая тема', colorScheme: 'light', storedTheme: 'system' },
  dark: { label: 'тёмная тема', colorScheme: 'dark', storedTheme: 'system' },
};

// The mobile «Входящие» section switch (buttons [data-pf-inbox-section-switch]) is part of the
// app: a missing switch is a failure. Set to false to report its checks as «ожидает
// доработки» instead (e.g. while running the smoke against an older build).
const INBOX_SECTION_SWITCH_REQUIRED = true;

// ---------------------------------------------------------------- helpers ----

const NOW = 'section[aria-label="В работе"]';
const QUEUE = 'section[aria-label="Очередь"]';
const card = (id) => `[data-pf-task-id="${id}"]`;

// Tasks of the «Очередь» of my inbox: mine (projects + personal), without the two shelves.
const myQueueTasks = (state) =>
  state.tasks.filter(
    (task) =>
      task.assignee.userId === ME.id &&
      task.status !== 'manual' &&
      task.status !== 'pending_approval',
  );
const approvalTasks = (state) => state.tasks.filter((task) => task.status === 'pending_approval');
const manualTasks = (state) =>
  state.tasks.filter((task) => task.status === 'manual' && task.assignee.userId === ME.id);
const queueColumnLabels = (state) => {
  const labels = new Set();
  for (const task of myQueueTasks(state)) {
    const project = state.projects.find((p) => p.id === task.projectId);
    labels.add(project?.isInbox ? 'Личные' : project?.name);
  }
  return [...labels];
};
const taskTitle = (state, id) => firstLine(state.tasks.find((task) => task.id === id));

// Ids of task cards rendered (with a non-empty box) inside `scope`.
function renderedCardIds(page, scope) {
  return page.locator(`${scope} [data-pf-task-id]`).evaluateAll((els) => [
    ...new Set(
      els
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        })
        .map((el) => el.getAttribute('data-pf-task-id')),
    ),
  ]);
}

async function expectCards(t, scope, expectedIds, what) {
  const expected = [...expectedIds].sort();
  await t.waitFor(async () => {
    const actual = (await renderedCardIds(t.page, scope)).sort();
    const ok = actual.length === expected.length && actual.every((id, i) => id === expected[i]);
    return ok || { ok: false, detail: `видно: ${actual.join(', ') || 'ничего'}; ждали: ${expected.join(', ')}` };
  }, `${what}: не тот набор карточек`);
}

async function expectGone(t, selector, what) {
  await t.waitFor(async () => (await t.page.locator(selector).count()) === 0, what);
}

async function checkDarkTheme(t) {
  if (t.theme !== 'dark') return;
  await t.check('тёмная тема применилась (html.dark)', async () => {
    const dark = await t.page.evaluate(() => document.documentElement.classList.contains('dark'));
    t.assert(dark, 'у <html> нет класса dark');
  });
}

// The project title is an input (EditableProjectTitle), not a heading.
async function checkProjectTitle(t, name) {
  await t.check(`название проекта «${name}»`, async () => {
    const title = t.page.getByRole('textbox', { name: 'Название проекта' });
    await t.visible(title, 'поле «Название проекта»');
    await t.waitFor(async () => (await title.first().inputValue()) === name, `в заголовке не «${name}»`);
  });
}

// Touch gestures through CDP: Playwright has tap() but no swipe or long press. The pauses
// between moves are part of the gesture (the app reads speed and hold time), not waits for
// a condition. Aim at the title row: touches on the phone row of quick actions do not start
// a gesture.
async function touchPoint(locator) {
  const box = await locator.first().boundingBox();
  if (!box) throw new Error('карточка вне экрана');
  return { x: box.x + Math.min(40, box.width / 2), y: box.y + Math.min(20, box.height / 2) };
}

async function touchSwipeRight(t, locator, distance = 150) {
  await locator.first().scrollIntoViewIfNeeded();
  const { x, y } = await touchPoint(locator);
  const cdp = await t.page.context().newCDPSession(t.page);
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let step = 1; step <= 15; step += 1) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (distance * step) / 15, y }] });
      await t.page.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await cdp.detach().catch(() => {});
  }
}

// Long press (longer than the TouchSensor delay of 220ms), then a drag onto `target`, which
// appears only once the drag has started (the dock of drop targets).
async function touchLongDrag(t, locator, target) {
  await locator.first().scrollIntoViewIfNeeded();
  // CDP touch events skip Playwright's actionability checks. A sheet that has just
  // closed can still block pointer events until its exit transition finishes.
  await locator.first().tap({ trial: true });
  const from = await touchPoint(locator);
  const cdp = await t.page.context().newCDPSession(t.page);
  const move = (x, y) => cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
    await t.page.waitForTimeout(400);
    for (let step = 1; step <= 6; step += 1) {
      await move(from.x, from.y + step * 4);
      await t.page.waitForTimeout(30);
    }
    await t.visible(target, 'цель броска в доке');
    const box = await target.first().boundingBox();
    if (!box) throw new Error('цель броска вне экрана');
    const to = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const start = { x: from.x, y: from.y + 24 };
    for (let step = 1; step <= 12; step += 1) {
      await move(start.x + ((to.x - start.x) * step) / 12, start.y + ((to.y - start.y) * step) / 12);
      await t.page.waitForTimeout(30);
    }
    await t.page.waitForTimeout(150);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await cdp.detach().catch(() => {});
  }
}

async function showSection(t, value) {
  const button = t.page.locator(`[data-pf-inbox-section-switch="${value}"]`).first();
  await button.tap();
  await t.waitFor(async () => (await button.getAttribute('aria-pressed')) === 'true', `раздел ${value} не выбран`);
}

// Opens a task card (click on desktop, tap on phones) and checks the task window. Aims at
// the title text: the middle of a phone card is its row of quick actions («выполнено»…).
async function openAndCloseTask(t, cardLocator, title) {
  const dialog = t.page.getByRole('dialog');
  const opened = await t.check(`${t.isMobile ? 'тап' : 'клик'} по карточке «${title}» открывает окно задачи`, async () => {
    await t.visible(cardLocator, `карточка «${title}»`);
    const target = cardLocator.first().getByText(title, { exact: true }).first();
    await target.scrollIntoViewIfNeeded();
    if (t.isMobile) await target.tap();
    else await target.click();
    await t.visible(dialog.getByText(title, { exact: false }), `окно задачи с заголовком «${title}»`);
  });
  if (!opened) {
    t.skip('Escape закрывает окно задачи', 'окно не открылось');
    return;
  }
  if (t.isMobile) await t.boxFitsCheck('окно задачи', '[role="dialog"]');
  await t.check('Escape закрывает окно задачи', async () => {
    await t.page.keyboard.press('Escape');
    await t.hidden(dialog, 'окно задачи после Escape');
  });
}

// ------------------------------------------------------------- scenarios ----

export const scenarios = [
  {
    id: 'auth',
    title: 'Вход, регистрация, сброс пароля',
    auth: false,
    matrix: [
      ['desktop', 'light'],
      ['desktop', 'dark'],
      ['phone', 'light'],
      ['phone', 'dark'],
      ['narrow', 'light'],
    ],
    async run(t) {
      const { page } = t;
      await t.goto('/', {
        ready: () => page.getByRole('heading', { name: 'Вход', level: 1 }),
        readyName: 'без входа открывается форма входа',
      });
      await t.check('без входа «/» уводит на /login', async () => {
        t.assert(new URL(page.url()).pathname === '/login', `адрес: ${page.url()}`);
      });
      await checkDarkTheme(t);
      await t.check('/login: поля Email и Пароль, кнопка «Войти»', async () => {
        await t.visible(page.getByLabel('Email', { exact: true }), 'поле Email');
        await t.visible(page.getByLabel('Пароль', { exact: true }), 'поле Пароль');
        await t.visible(page.getByRole('button', { name: 'Войти', exact: true }), 'кнопка «Войти»');
      });
      await t.pageChecks('/login');

      await t.step('/login → «Зарегистрироваться» открывает /register', async () => {
        await page.getByRole('link', { name: 'Зарегистрироваться' }).click();
        await t.visible(page.getByRole('heading', { name: 'Регистрация', level: 1 }), 'заголовок «Регистрация»');
      });
      await t.check('/register: поля Имя, Email, Пароль и кнопка «Создать аккаунт»', async () => {
        await t.visible(page.getByLabel('Имя', { exact: true }), 'поле Имя');
        await t.visible(page.getByLabel('Email', { exact: true }), 'поле Email');
        await t.visible(page.getByLabel('Пароль', { exact: true }), 'поле Пароль');
        await t.visible(page.getByRole('button', { name: 'Создать аккаунт' }), 'кнопка «Создать аккаунт»');
      });
      await t.pageChecks('/register');

      await t.goto('/forgot-password', {
        ready: () => page.getByRole('heading', { name: 'Сброс пароля', level: 1 }),
        readyName: 'форма сброса пароля',
      });
      await t.check('/forgot-password: поле Email и кнопка «Отправить ссылку»', async () => {
        await t.visible(page.getByLabel('Email', { exact: true }), 'поле Email');
        await t.visible(page.getByRole('button', { name: 'Отправить ссылку' }), 'кнопка «Отправить ссылку»');
      });
      await t.pageChecks('/forgot-password');
    },
  },

  {
    id: 'inbox',
    title: 'Входящие: «В работе» и «Очередь»',
    matrix: [
      ['desktop', 'light'],
      ['desktop', 'dark'],
    ],
    async run(t) {
      const { page, state } = t;
      await t.goto('/', { ready: () => page.locator(QUEUE), readyName: 'доска «Входящих» загрузилась' });
      await checkDarkTheme(t);
      await t.check('заголовок «Входящие»', () =>
        t.visible(page.getByRole('heading', { name: 'Входящие', level: 1 }), 'h1 «Входящие»'),
      );
      await t.check('«В работе»: полки «На утверждении» и «Вручную» с карточками', async () => {
        const now = page.locator(NOW);
        await t.visible(now, 'колонка «В работе»');
        await t.visible(now.getByText('На утверждении', { exact: true }), 'полка «На утверждении»');
        await t.visible(now.getByText('Вручную', { exact: true }), 'полка «Вручную»');
        await expectCards(t, NOW, [...approvalTasks(state), ...manualTasks(state)].map((x) => x.id), '«В работе»');
      });
      await t.check('«Очередь»: колонки проектов и все мои задачи', async () => {
        const queue = page.locator(QUEUE);
        for (const label of queueColumnLabels(state)) {
          await t.visible(queue.getByText(label, { exact: true }), `колонка «${label}»`);
        }
        await expectCards(t, QUEUE, myQueueTasks(state).map((x) => x.id), '«Очередь»');
      });
      await t.pageChecks('Входящие');
    },
  },

  {
    id: 'inbox-filters',
    title: 'Входящие: поиск, «/», Escape, срок, сброс',
    matrix: [['desktop', 'light']],
    async run(t) {
      const { page, state } = t;
      await t.goto('/', { ready: () => page.locator(QUEUE), readyName: 'доска «Входящих» загрузилась' });
      const all = myQueueTasks(state).map((x) => x.id);
      const search = page.getByRole('searchbox', { name: 'Поиск по проектам и задачам' });

      await t.check('«/» ставит курсор в поиск', async () => {
        await page.evaluate(() => {
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        });
        await page.keyboard.press('/');
        await t.waitFor(() => search.evaluate((el) => el === document.activeElement), 'фокус не в поле поиска');
        t.assert((await search.inputValue()) === '', 'в поле напечатался «/»');
      });
      await t.check('поиск «оплату» оставляет одну задачу, счётчик «1 из N»', async () => {
        await page.keyboard.type('оплату');
        await expectCards(t, QUEUE, ['t-pay'], 'очередь после поиска');
        await t.waitFor(
          async () => (await page.locator(QUEUE).innerText()).includes(`1 из ${all.length}`),
          `у очереди нет счётчика «1 из ${all.length}»`,
        );
      });
      await t.check('Escape очищает поиск', async () => {
        await search.press('Escape');
        t.assert((await search.inputValue()) === '', 'поле не очистилось');
        await expectCards(t, QUEUE, all, 'очередь после Escape');
      });

      const chip = page.getByRole('group', { name: 'Срок' }).getByRole('button', { name: /^Просрочено/ });
      await t.check('чип «Просрочено» оставляет только просроченные', async () => {
        await chip.click();
        await t.waitFor(async () => (await chip.getAttribute('aria-pressed')) === 'true', 'чип не нажат');
        const overdue = myQueueTasks(state).filter((x) => x.deadline && x.deadline < state.today);
        t.assert(overdue.length > 0, 'в фикстуре нет просроченных задач');
        await expectCards(t, QUEUE, overdue.map((x) => x.id), 'очередь с чипом «Просрочено»');
      });
      await t.check('«Сбросить фильтры» возвращает все задачи', async () => {
        await page.getByRole('button', { name: 'Сбросить фильтры' }).click();
        await expectCards(t, QUEUE, all, 'очередь после сброса');
        t.assert((await chip.getAttribute('aria-pressed')) === 'false', 'чип остался нажатым');
      });
      await t.pageChecks('Входящие с фильтрами');
    },
  },

  {
    id: 'inbox-actions',
    title: 'Входящие: «Взять в работу» и «Принять»',
    matrix: [['desktop', 'light']],
    async run(t) {
      const { page, state } = t;
      await t.goto('/', { ready: () => page.locator(QUEUE), readyName: 'доска «Входящих» загрузилась' });

      await t.check('«Взять в работу»: POST move → manual, карточка во «Вручную»', async () => {
        const queueCard = page.locator(`${QUEUE} ${card('t-pay')}`);
        await t.visible(queueCard, `карточка «${taskTitle(state, 't-pay')}» в очереди`);
        await queueCard.hover();
        await queueCard.locator('button[aria-label="Взять в работу"]:visible').click();
        await t.waitForMutation(
          (m) => m.method === 'POST' && m.path === '/projects/p-shop/tasks/t-pay/move' && m.body?.targetStatus === 'manual',
          'нет POST /api/projects/p-shop/tasks/t-pay/move с targetStatus "manual"',
        );
        const nowCard = page.locator(`${NOW} ${card('t-pay')}`);
        await t.visible(nowCard, 'карточка в «В работе»');
        await t.waitFor(
          async () => (await nowCard.locator('button[aria-label="Вернуть в очередь"]').count()) > 0,
          'у карточки нет действия «Вернуть в очередь» — она не на полке «Вручную»',
        );
        await expectGone(t, `${QUEUE} ${card('t-pay')}`, 'карточка осталась в очереди');
      });

      await t.check('«Принять» на полке «На утверждении»: POST move → done, карточка уходит', async () => {
        const approvalCard = page.locator(`${NOW} ${card('t-doctors')}`);
        await t.visible(approvalCard, `карточка «${taskTitle(state, 't-doctors')}» на утверждении`);
        await approvalCard.getByRole('button', { name: 'Принять' }).click();
        await t.waitForMutation(
          (m) => m.method === 'POST' && m.path === '/projects/p-site/tasks/t-doctors/move' && m.body?.targetStatus === 'done',
          'нет POST /api/projects/p-site/tasks/t-doctors/move с targetStatus "done"',
        );
        await expectGone(t, `${NOW} ${card('t-doctors')}`, 'карточка осталась на полке «На утверждении»');
      });
    },
  },

  {
    id: 'inbox-mobile',
    title: 'Входящие на телефоне',
    matrix: [
      ['phone', 'light'],
      ['phone', 'dark'],
      ['narrow', 'light'],
    ],
    async run(t) {
      const { page, state } = t;
      await t.goto('/', {
        ready: () => page.locator('[data-pf-task-id]:visible'),
        readyName: 'карточки «Входящих» видны',
      });
      await checkDarkTheme(t);
      await t.check('заголовок «Входящие»', () =>
        t.visible(page.getByRole('heading', { name: 'Входящие', level: 1 }), 'h1 «Входящие»'),
      );
      await t.pageChecks('Входящие');

      const nowIds = [...approvalTasks(state), ...manualTasks(state)].map((x) => x.id);
      const queueIds = myQueueTasks(state).map((x) => x.id);
      const switches = page.locator('[data-pf-inbox-section-switch]');
      if (!INBOX_SECTION_SWITCH_REQUIRED && (await switches.count()) === 0) {
        const why = 'в вёрстке ещё нет кнопок [data-pf-inbox-section-switch] — их добавляет мобильная доработка «Входящих»';
        t.expected('переключатель «В работе»/«Очередь»: кнопки now и queue, выбрана одна (aria-pressed)', why);
        t.expected('«В работе» и «Очередь» показываются по одному', why);
        await t.check('карточки «В работе» и «Очередь» видны', async () => {
          await expectCards(t, NOW, nowIds, '«В работе»');
          await expectCards(t, QUEUE, queueIds, '«Очередь»');
        });
      } else {
        await t.check('переключатель «В работе»/«Очередь»: кнопки now и queue, выбрана одна (aria-pressed)', async () => {
          const found = await switches.evaluateAll((els) =>
            els.map((el) => ({
              value: el.getAttribute('data-pf-inbox-section-switch'),
              pressed: el.getAttribute('aria-pressed'),
            })),
          );
          const values = found.map((x) => x.value);
          t.assert(values.includes('now') && values.includes('queue'), `значения кнопок: ${values.join(', ') || 'нет'}`);
          const pressed = found.filter((x) => x.pressed === 'true').map((x) => x.value);
          t.assert(pressed.length === 1, `aria-pressed="true" у: ${pressed.join(', ') || 'ни одной'}`);
        });
        for (const [value, shown, other, label, ids] of [
          ['now', NOW, QUEUE, 'В работе', nowIds],
          ['queue', QUEUE, NOW, 'Очередь', queueIds],
        ]) {
          await t.check(`переключатель → «${label}»: виден только этот раздел, все его карточки`, async () => {
            const button = page.locator(`[data-pf-inbox-section-switch="${value}"]`);
            await button.first().tap();
            await t.waitFor(async () => (await button.first().getAttribute('aria-pressed')) === 'true', 'кнопка не выбрана');
            await t.visible(page.locator(shown), `раздел «${label}»`);
            await t.hidden(page.locator(other), 'второй раздел');
            await expectCards(t, shown, ids, `«${label}»`);
          });
          await t.pageChecks(`Входящие, раздел «${label}»`, { bottomNav: false });
        }
      }

      await openAndCloseTask(t, page.locator(`${QUEUE} ${card('t-home')}`), taskTitle(state, 't-home'));
    },
  },

  {
    id: 'inbox-gestures',
    title: 'Входящие на телефоне: свайп, перетаскивание, поиск',
    matrix: [['phone', 'light']],
    async run(t) {
      const { page, state } = t;
      await t.goto('/', {
        ready: () => page.locator('[data-pf-inbox-section-switch]'),
        readyName: 'переключатель разделов «Входящих»',
      });
      await t.step('переключатель → «Очередь»', () => showSection(t, 'queue'));

      const swiped = await t.check('свайп вправо по карточке очереди берёт её в работу (POST move → manual)', async () => {
        const queueCard = page.locator(`${QUEUE} ${card('t-home')}`);
        await t.visible(queueCard, `карточка «${taskTitle(state, 't-home')}» в очереди`);
        await touchSwipeRight(t, queueCard);
        await t.waitForMutation(
          (m) => m.method === 'POST' && m.path === '/projects/p-site/tasks/t-home/move' && m.body?.targetStatus === 'manual',
          'нет POST /api/projects/p-site/tasks/t-home/move с targetStatus "manual"',
        );
        await expectGone(t, `${QUEUE} ${card('t-home')}`, 'карточка осталась в очереди');
      });
      if (swiped) {
        await t.check('взятая задача — в разделе «В работе»', async () => {
          await showSection(t, 'now');
          await t.visible(page.locator(`${NOW} ${card('t-home')}`), 'карточка в «В работе»');
        });
      } else {
        t.skip('взятая задача — в разделе «В работе»', 'свайп не сработал');
      }

      await t.check('долгий тап и бросок на «Готово» в доке закрывает задачу (POST move → done)', async () => {
        await showSection(t, 'queue');
        const queueCard = page.locator(`${QUEUE} ${card('t-pay')}`);
        await t.visible(queueCard, `карточка «${taskTitle(state, 't-pay')}» в очереди`);
        await touchLongDrag(t, queueCard, page.locator('[data-pf-dock-target="done-bar"]'));
        await t.waitForMutation(
          (m) => m.method === 'POST' && m.path === '/projects/p-shop/tasks/t-pay/move' && m.body?.targetStatus === 'done',
          'нет POST /api/projects/p-shop/tasks/t-pay/move с targetStatus "done"',
        );
        await t.hidden(page.locator('[data-pf-dock-target]'), 'док целей после броска');
        // «Скрыть выполненные» выключено — закрытая задача остаётся в очереди зачёркнутой,
        // а её «выполнено» становится «снять отметку».
        await t.visible(
          queueCard.locator('button[aria-label="Снять отметку «выполнено»"]:visible'),
          'карточка не стала выполненной',
        );
      });

      await t.check('лупа раскрывает поиск, «домен» оставляет одну задачу, крестик закрывает', async () => {
        await showSection(t, 'queue');
        await page.getByRole('button', { name: 'Поиск по проектам и задачам' }).tap();
        const search = page.getByRole('searchbox', { name: 'Поиск по проектам и задачам' });
        await t.waitFor(() => search.evaluate((el) => el === document.activeElement), 'фокус не в поле поиска');
        await search.fill('домен');
        await expectCards(t, QUEUE, ['t-domain'], 'очередь после поиска');
        await page.getByRole('button', { name: 'Закрыть поиск' }).tap();
        await t.hidden(search, 'поле поиска после закрытия');
        await t.waitFor(
          async () => (await renderedCardIds(page, QUEUE)).length > 1,
          'после закрытия поиска очередь не вернулась',
        );
      });
      await t.pageChecks('Входящие после жестов', { bottomNav: false });
    },
  },

  {
    id: 'inbox-create',
    title: 'Входящие: создание в черновиках при активных фильтрах',
    matrix: [['desktop', 'light'], ['phone', 'light'], ['narrow', 'dark']],
    async run(t) {
      const { page, state } = t;
      await t.goto('/', { ready: () => page.locator('[data-pf-task-id]:visible') });
      if (t.isMobile) await showSection(t, 'queue');
      const searchLabel = 'Поиск по проектам и задачам';
      if (t.isMobile) {
        const toggle = page.getByRole('button', { name: searchLabel });
        const switchBox = await page.getByRole('group', { name: 'Раздел', exact: true }).boundingBox();
        const searchBox = await toggle.boundingBox();
        t.assert(switchBox && searchBox && searchBox.x >= switchBox.x + switchBox.width, 'поиск не справа от разделов');
        await toggle.click();
      }
      const search = page.getByRole('searchbox', { name: searchLabel });
      await t.check('название проекта фильтрует его задачи', async () => {
        await search.fill('Сайт клиники');
        await expectCards(t, QUEUE, myQueueTasks(state).filter((task) => task.projectId === BOARD_PROJECT_ID).map((task) => task.id), 'поиск проекта');
      });
      await search.fill('блок акций');
      await expectCards(t, QUEUE, ['t-home'], 'поиск по содержанию');
      await page.getByRole('group', { name: 'Срок', exact: true }).getByRole('button', { name: /^Просрочено/ }).click();
      const create = page.locator(QUEUE).getByRole('button', { name: 'Создать задачу в проекте' }).first();
      await create.click();
      const field = page.getByRole('textbox', { name: 'Название задачи', exact: true });
      await field.fill('Новая задача из входящих');
      if (t.isMobile) {
        t.assert(await field.evaluate((el) => parseFloat(getComputedStyle(el).fontSize) >= 16), 'поле запускает автозум');
        t.assert(await search.evaluate((el) => parseFloat(getComputedStyle(el).fontSize) >= 16), 'поиск запускает автозум');
      }
      await t.check('Enter создаёт один черновик в выбранном проекте и оставляет карточку', async () => {
        await field.press('Enter');
        await t.waitForMutation((m) => m.method === 'POST' && m.path === `/projects/${BOARD_PROJECT_ID}/tasks` && m.body?.status === 'backlog', 'создание не в черновиках проекта');
        const saved = state.tasks.find((task) => task.description === 'Новая задача из входящих');
        t.assert(saved?.assignee.userId === ME.id, 'неверный ответственный');
        await t.visible(page.locator(`${QUEUE} ${card(saved.id)}`), 'сохранённая карточка');
        t.assert((await search.inputValue()) === '', 'скрывающий фильтр не сброшен');
        t.assert(t.journal.mutations.filter((m) => m.method === 'POST' && m.path === `/projects/${BOARD_PROJECT_ID}/tasks`).length === 1, 'дубликат создания');
      });
      await t.pageChecks('Входящие после создания');
    },
  },

  {
    id: 'board',
    title: 'Доска проекта и окно задачи',
    matrix: [
      ['desktop', 'light'],
      ['desktop', 'dark'],
      ['phone', 'light'],
      ['narrow', 'light'],
    ],
    async run(t) {
      const { page, state } = t;
      const project = state.projects.find((p) => p.id === BOARD_PROJECT_ID);
      const tasks = state.tasks.filter((x) => x.projectId === BOARD_PROJECT_ID && x.status !== 'done');
      await t.goto(`/projects/${BOARD_PROJECT_ID}`, {
        ready: () => page.locator('[data-pf-task-id]'),
        readyName: 'карточки доски видны',
      });
      await checkDarkTheme(t);
      await checkProjectTitle(t, project.name);
      await t.check('карточки задач проекта на доске', async () => {
        for (const task of tasks) {
          await t.waitFor(
            async () => (await page.locator(card(task.id)).count()) > 0,
            `нет карточки «${firstLine(task)}»`,
          );
        }
      });
      await t.pageChecks('доска проекта');
      await openAndCloseTask(t, page.locator(card('t-home')), taskTitle(state, 't-home'));
    },
  },

  {
    id: 'task-properties',
    title: 'Свойства задачи: шторки, статус, проект и порядок строк',
    matrix: [['desktop', 'light'], ['phone', 'light'], ['narrow', 'dark']],
    async run(t) {
      const { page } = t;
      const properties = page.locator('[data-pf-task-properties]');
      const press = (locator) => t.isMobile ? locator.tap() : locator.click();
      await t.goto(`/projects/${BOARD_PROJECT_ID}/tasks/t-home`, { ready: () => properties });
      await t.check('подписи свойств и «Создано» в меню', async () => {
        for (const label of ['Статус', 'Проект', 'Исполнитель', 'Срок до', 'Кто утверждает']) {
          await t.visible(properties.getByText(label, { exact: true }), label);
        }
        t.assert(await properties.getByText('Создано', { exact: true }).count() === 0, 'метаданные остались среди свойств');
        await press(page.getByRole('button', { name: 'Ещё', exact: true }));
        await t.visible(page.getByRole('menu').getByText('Создано', { exact: true }), 'дата создания в меню');
        await page.keyboard.press('Escape');
      });
      await t.check('выбор статуса сохраняет ручную работу', async () => {
        await press(page.getByRole('button', { name: 'Сменить статус', exact: true }));
        const menu = page.getByRole('menu');
        await t.visible(menu.getByText('Статус задачи', { exact: true }), 'заголовок выбора статуса');
        if (t.isMobile) t.assert(await menu.getAttribute('data-pf-mobile-sheet') === 'true', 'статус открылся не нижней шторкой');
        await press(menu.getByRole('menuitemradio', { name: 'Вручную', exact: true }));
        await t.waitForMutation((m) => m.path.endsWith('/t-home/move') && m.body?.targetStatus === 'manual', 'статус не сохранён');
        await t.waitFor(async () => (await page.getByRole('button', { name: 'Сменить статус', exact: true }).innerText()).includes('Вручную'), 'статус не обновился');
      });
      await t.check('список утверждающих открывается с полными именами', async () => {
        await press(properties.getByRole('button', { name: 'Кто утверждает', exact: true }));
        const sheet = page.getByRole('dialog', { name: 'Кто утверждает' });
        await t.visible(sheet.getByText('Анна Смирнова', { exact: true }), 'имя владельца');
        await t.visible(sheet.getByText('Борис Котов', { exact: true }), 'имя руководителя');
        if (t.isMobile) t.assert(await sheet.getAttribute('data-pf-mobile-sheet') === 'true', 'утверждающие открылись не нижней шторкой');
        await page.keyboard.press('Escape');
      });
      if (t.isMobile) await t.check('долгий тап переставляет строку и сохраняет порядок аккаунта', async () => {
        await touchLongDrag(t, properties.locator('[data-pf-task-property="status"]'), properties.locator('[data-pf-task-property="assignee"]'));
        await t.waitForMutation((m) => m.path === '/me/ui-prefs' && Array.isArray(m.body?.prefs?.taskPropertyOrder), 'порядок не сохранён');
      });
      await t.check('смена проекта переносит задачу и открывает её новый адрес', async () => {
        await press(page.getByRole('button', { name: 'Сменить проект', exact: true }));
        const sheet = page.getByRole('dialog', { name: 'Выбор проекта' });
        await t.visible(sheet, 'выбор проекта');
        if (t.isMobile) t.assert(await sheet.getAttribute('data-pf-mobile-sheet') === 'true', 'проекты открылись не нижней шторкой');
        await press(sheet.getByRole('option', { name: 'Личные задачи', exact: true }));
        await t.waitForMutation((m) => m.path.endsWith('/t-home/assign-to-project'), 'перенос не отправлен');
        await t.waitFor(() => new URL(page.url()).pathname.endsWith('/p-inbox-anna/tasks/t-home'), 'не открыт новый адрес задачи');
      });
      await t.pageChecks('обновлённые свойства задачи');
    },
  },

  {
    id: 'mobile-nav',
    title: 'Телефон: нижняя навигация и меню',
    matrix: [
      ['phone', 'light'],
      ['narrow', 'light'],
    ],
    async run(t) {
      const { page } = t;
      const nav = page.locator('nav[aria-label="Основная навигация"]');
      await t.goto('/', { ready: () => nav, readyName: 'нижняя навигация' });
      for (const [label, path, ready] of [
        ['ИИ', '/ai', () => page.getByRole('heading', { name: 'ProjectsFlow ИИ', level: 1 })],
        ['Профиль', '/profile', () => page.getByText('Личные данные', { exact: true })],
        ['Входящие', '/', () => page.getByRole('heading', { name: 'Входящие', level: 1 })],
      ]) {
        await t.check(`нижняя панель: «${label}» открывает ${path}`, async () => {
          const button = nav.getByRole('button', { name: label, exact: true });
          await button.tap();
          await t.waitFor(() => new URL(page.url()).pathname === path, `адрес не ${path}`);
          await t.visible(ready(), `содержимое ${path}`);
          t.assert((await button.getAttribute('aria-current')) === 'page', 'кнопка не отмечена текущей (aria-current)');
        });
      }

      const menu = page.locator('[data-pf-drawer-content]');
      const projectLink = menu.locator(`a[href="/projects/${BOARD_PROJECT_ID}"]`);
      const opened = await t.check('«Открыть меню» показывает меню с проектами', async () => {
        await page.getByRole('button', { name: 'Открыть меню' }).tap();
        await t.visible(projectLink, 'проект «Сайт клиники» в меню');
      });
      if (!opened) {
        t.skip('проект из меню открывает доску', 'меню не открылось');
        return;
      }
      await t.boxFitsCheck('меню', '[data-pf-drawer-content]');
      await t.check('проект из меню открывает доску, меню закрывается', async () => {
        await projectLink.tap();
        await t.waitFor(() => new URL(page.url()).pathname === `/projects/${BOARD_PROJECT_ID}`, 'адрес не доски проекта');
        await t.hidden(menu, 'меню после перехода');
        await t.visible(page.locator('[data-pf-task-id]'), 'карточки доски');
      });
    },
  },

  {
    id: 'overview',
    title: 'Обзор проекта',
    matrix: [
      ['desktop', 'light'],
      ['phone', 'light'],
      ['narrow', 'light'],
    ],
    async run(t) {
      const { page, state } = t;
      const project = state.projects.find((p) => p.id === BOARD_PROJECT_ID);
      await t.goto(`/projects/${BOARD_PROJECT_ID}/overview`, {
        ready: () => page.getByRole('link', { name: 'Доска задач' }),
        readyName: 'обзор проекта загрузился',
      });
      await checkProjectTitle(t, project.name);
      await t.check('команда проекта', () => t.visible(page.getByText('Борис Котов'), 'участник «Борис Котов»'));
      await t.pageChecks('обзор проекта');
    },
  },

  {
    id: 'profile',
    title: 'Профиль',
    matrix: [
      ['desktop', 'light'],
      ['phone', 'light'],
      ['narrow', 'light'],
    ],
    async run(t) {
      const { page } = t;
      await t.goto('/profile', {
        ready: () => page.getByText('Личные данные', { exact: true }),
        readyName: 'карточка «Личные данные»',
      });
      await t.check('имя и email пользователя в форме', async () => {
        const name = page.locator('input#displayName');
        await t.visible(name, 'поле Имя');
        await t.waitFor(async () => (await name.inputValue()) === ME.displayName, `в поле Имя не «${ME.displayName}»`);
        t.assert((await page.locator('input#email').inputValue()) === ME.email, 'email не совпадает');
      });
      await t.pageChecks('профиль');
    },
  },

  {
    id: 'workspace-settings',
    title: 'Настройки пространства',
    matrix: [
      ['desktop', 'light'],
      ['phone', 'light'],
      ['narrow', 'light'],
    ],
    async run(t) {
      const { page } = t;
      await t.goto(`/workspaces/${WORKSPACE_ID}/settings`, {
        ready: () => page.getByText('Участники', { exact: true }),
        readyName: 'карточка «Участники»',
      });
      await t.check('название пространства и участники', async () => {
        await t.visible(page.getByRole('heading', { name: 'Команда «Смоук»' }), 'заголовок «Команда «Смоук»»');
        await t.visible(page.getByText('Вера Лебедева').first(), 'участник «Вера Лебедева»');
      });
      await t.pageChecks('настройки пространства');
    },
  },

  {
    id: 'ai',
    title: 'ИИ',
    matrix: [
      ['desktop', 'light'],
      ['phone', 'light'],
      ['narrow', 'light'],
    ],
    async run(t) {
      const { page } = t;
      await t.goto('/ai', {
        ready: () => page.getByRole('heading', { name: 'ProjectsFlow ИИ', level: 1 }),
        readyName: 'заголовок «ProjectsFlow ИИ»',
      });
      await t.check('поле ввода и «Открыть пустой чат»', async () => {
        await t.visible(page.getByRole('button', { name: 'Открыть пустой чат' }), 'кнопка «Открыть пустой чат»');
        await t.visible(page.locator('[contenteditable="true"], textarea').first(), 'поле ввода запроса');
      });
      await t.pageChecks('ИИ');
    },
  },

  {
    id: 'not-found',
    title: 'Несуществующий адрес → 404',
    matrix: [
      ['desktop', 'light'],
      ['phone', 'light'],
    ],
    async run(t) {
      const { page } = t;
      await t.goto('/no-such-page/at-all', {
        ready: () => page.getByRole('heading', { name: /Страница не\s+найдена/ }),
        readyName: 'страница «Страница не найдена»',
      });
      await t.check('метка 404 и ссылка «На главную»', async () => {
        await t.visible(page.getByText('404', { exact: true }), 'метка 404');
        await t.visible(page.getByRole('link', { name: /На\s+главную/ }), 'ссылка «На главную»');
      });
      await t.pageChecks('404');
    },
  },
];
