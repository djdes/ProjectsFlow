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

import { BOARD_PROJECT_ID, COLLEAGUES, INBOX_ID, ME, WORKSPACE_ID, firstLine } from './fixtures.mjs';
import { workspaceIsolationScenarios } from './workspace-isolation.mjs';
import { telegramConnectScenarios } from './telegram-connect.mjs';
import { taskCreationDefaultsScenarios } from './task-creation-defaults.mjs';
import { quickTaskSettingsScenarios } from './quick-task-settings.mjs';

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
    // dnd-kit keeps its click guard for 50ms after release. A new human tap happens
    // after that guard; fast CI must not send the next gesture into it.
    await t.page.waitForTimeout(100);
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
  ...telegramConnectScenarios,
  ...taskCreationDefaultsScenarios,
  ...quickTaskSettingsScenarios,
  ...workspaceIsolationScenarios,
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
      await t.check('нижняя полоса прокрутки доводит ряд колонок до последней', async () => {
        const bar = page.locator('[data-pf-sticky-hscroll]');
        await t.visible(bar, 'полоса прокрутки под колонками');
        await bar.evaluate((el) => {
          el.scrollLeft = el.scrollWidth;
        });
        const rowEnd = () =>
          page.locator(QUEUE).evaluate((queue) => {
            const row = [...queue.querySelectorAll('*')].find(
              (el) => getComputedStyle(el).overflowX === 'auto' && el.scrollWidth > el.clientWidth + 1,
            );
            return row ? row.scrollWidth - row.clientWidth - row.scrollLeft : null;
          });
        await t.waitFor(async () => {
          const left = await rowEnd();
          return left !== null && left <= 2;
        }, 'полоса упёрлась в край, а ряд колонок не долистан до конца');
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
    id: 'inbox-approval-queue',
    title: 'Полка «На утверждении»: личная задача сотрудника, которую руководитель не ставил',
    matrix: [['desktop', 'light']],
    async run(t) {
      const { page, state } = t;
      // Инцидент 14.10.2026: задачу во «Входящие» сотрудника поставил не руководитель, сотрудник
      // её сдал — у руководителя полка была пустой: ни «Мне», ни «Другим», ни личные коллег её
      // не отдают. Теперь её приносит очередь приёмки (/assignees/approvals).
      const boris = COLLEAGUES.find((c) => c.id === 'u-boris');
      const ref = { userId: boris.id, displayName: boris.displayName, avatarUrl: null };
      const inbox = state.projects.find((p) => p.id === INBOX_ID);
      state.projects.push({ ...inbox, id: 'p-inbox-boris', ownerId: boris.id });
      const template = state.tasks.find((x) => x.id === 't-vera-report');
      state.tasks.push({
        ...template,
        id: 't-boris-personal',
        projectId: 'p-inbox-boris',
        description: 'Добавить поля КБЖУ в каталог',
        status: 'pending_approval',
        assignee: ref,
        creator: ref,
      });
      await t.goto('/', { ready: () => page.locator(QUEUE), readyName: 'доска «Входящих» загрузилась' });
      await t.check('задача сотрудника на полке и принимается', async () => {
        const approvalCard = page.locator(`${NOW} ${card('t-boris-personal')}`);
        await t.visible(approvalCard, 'личная задача Бориса на полке «На утверждении»');
        await approvalCard.getByRole('button', { name: 'Принять' }).click();
        await t.waitForMutation(
          (m) => m.method === 'POST' && m.path === '/projects/p-inbox-boris/tasks/t-boris-personal/move' && m.body?.targetStatus === 'done',
          'нет POST move → done для личной задачи сотрудника',
        );
        await expectGone(t, `${NOW} ${card('t-boris-personal')}`, 'принятая задача осталась на полке');
      });
      await t.pageChecks('Входящие: очередь приёмки');
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
      await t.check('кнопка «Взять в работу» на черновике переносит его в «Вручную»', async () => {
        const draft = page.locator(card('t-prices')).first();
        if (!t.isMobile) await draft.hover();
        const take = draft.getByRole('button', { name: 'Взять в работу' }).filter({ visible: true }).first();
        await t.visible(take, 'кнопка «Взять в работу»');
        if (t.isMobile) await take.tap();
        else await take.click();
        await t.waitForMutation(
          (m) => m.method === 'POST' && m.path === `/projects/${BOARD_PROJECT_ID}/tasks/t-prices/move` && m.body?.targetStatus === 'manual',
          'нет переноса черновика в «Вручную»',
        );
      });
    },
  },

  {
    id: 'task-notifications',
    title: 'Уведомление об изменении срока и переход в задачу',
    matrix: [['desktop', 'light'], ['phone', 'light']],
    async run(t) {
      const { page, state } = t;
      const task = state.tasks.find((item) => item.id === 't-home');
      const createdAt = new Date().toISOString();
      state.feed = [{ type: 'notification', createdAt, notification: {
        id: 'deadline-notification', userId: ME.id, createdAt, readAt: null, taskDeleted: false,
        payload: { type: 'task_changed', action: 'updated', title: 'Задача изменена',
          taskId: task.id, projectId: task.projectId, projectName: 'Сайт компании',
          taskExcerpt: firstLine(task), actorUserId: 'lead', actorDisplayName: 'Руководитель',
          detail: 'Срок до: 12.10.2026 → 20.10.2026', taskAvailable: true },
      } }];
      await page.addInitScript(() => {
        localStorage.setItem('pf_sidebar_rail', 'chat');
        localStorage.setItem('pf_comm_tab', 'all');
      });
      await t.goto('/', { ready: () => page.locator(NOW) });
      if (t.isMobile) await page.getByRole('button', { name: 'Открыть меню', exact: true }).tap();
      await t.step('уведомление показывает событие коротко, без дат', async () => {
        // 16.10.2026: «не показывай в уведомлениях сроки, нужно меньше инфы».
        await t.visible(page.getByText('Изменение', { exact: true }), 'метка вида уведомления');
        await t.visible(page.getByText('Изменён срок', { exact: true }), 'факт смены срока');
        if (await page.getByText('Срок до: 12.10.2026 → 20.10.2026', { exact: true }).count()) throw new Error('в уведомлении остались даты срока');
      });
      await t.step('клик помечает прочитанным и открывает конкретную задачу', async () => {
        const notice = page.getByText('Изменение', { exact: true });
        if (t.isMobile) await notice.tap(); else await notice.click();
        await t.waitForMutation((m) => m.path === '/notifications/deadline-notification/read', 'уведомление не прочитано');
        await t.waitFor(() => page.url().includes(`/tasks/${task.id}`), 'нет перехода к задаче');
        await t.visible(page.locator('[data-pf-task-properties]'), 'открытая задача');
      });
      await t.pageChecks('задача из уведомления');
    },
  },

  {
    id: 'task-notification-private',
    title: 'Личная задача из уведомления: доступ только к карточке',
    matrix: [['phone', 'light']],
    async run(t) {
      const task = t.state.tasks.find((item) => item.id === 't-home');
      task.projectId = 'private-inbox';
      task.assignee = { userId: 'worker-personal', displayName: 'Исполнитель', avatarUrl: null };
      task.canEdit = true;
      task.context = { projectName: 'Личные задачи исполнителя', workspaceId: WORKSPACE_ID, isInbox: true, canReadProject: false };
      await t.goto('/projects/private-inbox/tasks/t-home', { ready: () => t.page.locator('[data-pf-task-properties]') });
      await t.check('задача редактируется без открытия приватного проекта', async () => {
        const status = t.page.getByRole('button', { name: 'Сменить статус', exact: true });
        t.assert(await status.isEnabled(), 'у принимающего нет действия смены статуса');
        await t.visible(t.page.getByText('Личные задачи', { exact: true }), 'личная задача');
        await status.tap();
        await t.page.getByRole('menuitemradio', { name: 'Готово', exact: true }).tap();
        await t.waitForMutation((m) => m.path === '/projects/private-inbox/tasks/t-home/move' && m.body?.targetStatus === 'done', 'принятие задачи не сохранено');
      });
      await t.pageChecks('личная задача по прямой ссылке');
      await t.check('руководитель переносит личную задачу в проект через шторку', async () => {
        await t.page.getByRole('button', { name: 'Сменить проект', exact: true }).tap();
        const sheet = t.page.getByRole('dialog', { name: 'Выбор проекта' });
        t.assert(await sheet.getAttribute('data-pf-mobile-sheet') === 'true', 'выбор проекта открылся не шторкой');
        const project = t.state.projects.find(item => item.id === BOARD_PROJECT_ID);
        await sheet.getByRole('option', { name: project.name, exact: true }).tap();
        await t.waitForMutation(m => m.path === '/projects/private-inbox/tasks/t-home/assign-to-project' && m.body?.targetProjectId === BOARD_PROJECT_ID, 'перенос личной задачи не сохранён');
        await t.waitFor(() => new URL(t.page.url()).pathname === `/projects/${BOARD_PROJECT_ID}/tasks/t-home`, 'новая карточка не открылась');
        await t.waitFor(async () => (await t.page.getByRole('button', { name: 'Сменить проект', exact: true }).innerText()).includes(project.name), 'название проекта не обновилось');
      });
      await t.pageChecks('перенесённая личная задача');
    },
  },

  {
    id: 'task-personal-project',
    title: 'Личная задача: перенос в проект и обратно',
    matrix: [['desktop', 'light'], ['phone', 'light'], ['narrow', 'dark']],
    async run(t) {
      const { page } = t;
      const press = locator => t.isMobile ? locator.tap() : locator.click();
      const task = t.state.tasks.find(item => item.id === 't-domain');
      const inboxId = task.projectId;
      const project = t.state.projects.find(item => item.id === BOARD_PROJECT_ID);
      await t.goto('/', { ready: () => page.locator('[data-pf-task-id]:visible') });
      if (t.isMobile) await press(page.locator('[data-pf-inbox-section-switch="queue"]').first());
      await press(page.locator(card(task.id)).getByText(taskTitle(t.state, task.id), { exact: true }));
      await t.visible(page.locator('[data-pf-task-properties]'), 'карточка личной задачи');
      await t.check('из личных задач доступен выбор проекта', async () => {
        await press(page.getByRole('button', { name: 'Сменить проект', exact: true }));
        const sheet = page.getByRole('dialog', { name: 'Выбор проекта' });
        if (t.isMobile) t.assert(await sheet.getAttribute('data-pf-mobile-sheet') === 'true', 'выбор открылся не шторкой');
        await press(sheet.getByRole('option', { name: project.name, exact: true }));
        await t.waitForMutation(m => m.path === `/projects/${inboxId}/tasks/${task.id}/assign-to-project` && m.body?.targetProjectId === BOARD_PROJECT_ID, 'проект не сохранён');
        await t.hidden(page.locator('[data-pf-task-properties]'), 'окно закрылось после переноса');
      });
      await t.check('проект сохраняется после повторного открытия; можно вернуть в личные', async () => {
        await t.goto(`/projects/${BOARD_PROJECT_ID}/tasks/${task.id}`, { ready: () => page.locator('[data-pf-task-properties]') });
        await page.reload();
        const picker = page.getByRole('button', { name: 'Сменить проект', exact: true });
        await t.waitFor(async () => (await picker.innerText()).includes(project.name), 'проект потерялся после обновления');
        await press(picker);
        await press(page.getByRole('dialog', { name: 'Выбор проекта' }).getByRole('option', { name: 'Личные задачи', exact: true }));
        await t.waitForMutation(m => m.path === `/projects/${BOARD_PROJECT_ID}/tasks/${task.id}/assign-to-project` && m.body?.targetProjectId === inboxId, 'возврат в личные задачи не сохранён');
        await t.waitFor(() => new URL(page.url()).pathname === `/projects/${inboxId}/tasks/${task.id}`, 'адрес личной задачи не открыт');
      });
      await t.pageChecks('смена проекта у личной задачи');
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
    id: 'task-drawer-pickers',
    title: 'Окно задачи: вложенные шторки, порядок строк и перенос',
    matrix: [['phone', 'light'], ['narrow', 'dark']],
    async run(t) {
      const { page, state } = t;
      await t.goto(`/projects/${BOARD_PROJECT_ID}`, { ready: () => page.locator(card('t-home')) });
      await page.locator(card('t-home')).getByText(taskTitle(state, 't-home'), { exact: true }).tap();
      const properties = page.locator('[data-pf-task-properties]');
      await t.visible(properties, 'свойства в окне задачи');
      await t.step('закрытие вложенной шторки сохраняет окно задачи', async () => {
        await properties.getByRole('button', { name: 'Кто утверждает', exact: true }).tap();
        const picker = page.getByRole('dialog', { name: 'Кто утверждает' });
        await t.visible(picker.getByText('Анна Смирнова', { exact: true }), 'имя утверждающего');
        await page.keyboard.press('Escape');
        await t.hidden(picker, 'закрытая шторка утверждающих');
        await t.visible(properties, 'окно задачи после закрытия шторки');
      });
      await t.step('долгий тап меняет порядок внутри окна, не закрывая его', async () => {
        await touchLongDrag(t, properties.locator('[data-pf-task-property="status"]'), properties.locator('[data-pf-task-property="assignee"]'));
        await t.waitForMutation((m) => m.path === '/me/ui-prefs', 'порядок не сохранён');
        await t.visible(properties, 'окно задачи после перестановки');
      });
      await t.step('перенос через вложенную шторку убирает задачу из исходной доски', async () => {
        await properties.getByRole('button', { name: 'Сменить проект', exact: true }).tap();
        await page.getByRole('dialog', { name: 'Выбор проекта' }).getByRole('option', { name: 'Личные задачи', exact: true }).tap();
        await t.waitForMutation((m) => m.path.endsWith('/t-home/assign-to-project'), 'перенос не отправлен');
        await t.hidden(properties, 'окно закрылось после переноса');
        await expectGone(t, card('t-home'), 'задача осталась на исходной доске');
      });
      await t.pageChecks('доска после переноса');
    },
  },

  {
    id: 'notifications-bell',
    title: 'Колокольчик: приглашение в чужое пространство и лента уведомлений',
    matrix: [['desktop', 'light'], ['phone', 'light']],
    async run(t) {
      const { page, state } = t;
      // 16.10.2026: колокольчика не было, а приглашение в чужое пространство не показывалось
      // нигде — лента скоупилась активным пространством.
      const ago = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();
      state.notifications = [
        { id: 'n-invite', userId: ME.id, createdAt: ago(5), readAt: null, taskDeleted: false,
          payload: { type: 'workspace_invite', workspaceId: 'ws-foreign', workspaceName: 'Студия Север',
            role: 'editor', inviteId: 'inv-1', token: 'tok-1', actorUserId: 'u-ext', actorDisplayName: 'Игорь Петров' } },
        { id: 'n-change', userId: ME.id, createdAt: ago(60), readAt: null, taskDeleted: false,
          payload: { type: 'task_changed', action: 'updated', title: 'Срок изменён', taskId: 't-x', projectId: BOARD_PROJECT_ID,
            projectName: 'Сайт клиники', taskExcerpt: 'Обновить прайс', actorUserId: 'u-boris',
            actorDisplayName: 'Борис', detail: 'Срок до: 12.10.2026 → 20.10.2026', taskAvailable: true } },
        { id: 'n-created', userId: ME.id, createdAt: ago(30), readAt: null, taskDeleted: false, forMe: true,
          payload: { type: 'task_changed', action: 'created', title: 'Создана задача', taskId: 't-y', projectId: 'p-inbox-anna',
            projectName: 'inbox:65db53ef-b4e7-46f0-bd0b-6a3083292aed', taskExcerpt: 'Повтор заказа нужен', actorUserId: 'u-boris',
            actorDisplayName: 'Борис', detail: 'Исполнитель: Анна Смирнова\nСрок до: 16.10.2026', taskAvailable: true } },
        // Запрос доступа к удалённому проекту: сервер отдаёт actionState=expired — кнопок нет.
        { id: 'n-stale-join', userId: ME.id, createdAt: ago(90), readAt: ago(80), taskDeleted: false, actionState: 'expired',
          payload: { type: 'join_request', projectId: 'p-gone', projectName: 'Старый проект', joinRequestId: 'jr-gone',
            requesterUserId: 'u-den', requesterDisplayName: 'Денис', actorUserId: 'u-den', actorDisplayName: 'Денис' } },
      ];
      await t.goto('/', { ready: () => page.locator(NOW) });
      if (t.isMobile) await page.getByRole('button', { name: 'Открыть меню', exact: true }).tap();
      const bell = page.getByRole('button', { name: /^Уведомления/ }).first();
      await t.check('бейдж колокольчика — неотвеченное приглашение', async () => {
        await t.visible(page.getByRole('button', { name: 'Уведомления: 1 новых' }), 'колокольчик с бейджем 1');
      });
      await t.check('колокольчик открывает приглашение и ленту', async () => {
        if (t.isMobile) await bell.tap(); else await bell.click();
        const pending = page.getByRole('region', { name: 'Ждут ответа' });
        await t.visible(pending.getByText('Студия Север', { exact: true }), 'приглашение в «Ждут ответа»');
        await t.visible(page.getByText('Запрос больше не актуален', { exact: true }), 'устаревший запрос доступа — итог вместо кнопок');
        await t.visible(page.getByText('Новая задача', { exact: true }), 'метка «Новая задача»');
        const panel = page.locator('[data-pf-motion-surface="popover"]');
        await t.visible(panel.getByText('Входящие', { exact: true }), '«Входящие» вместо служебного inbox:<id>');
        if (await panel.getByText(/inbox:/).count()) throw new Error('в колокольчике осталось служебное имя inbox:<id>');
        if (await page.getByRole('button', { name: 'Отклонить' }).count()) throw new Error('у устаревшего запроса остались кнопки');
      });
      await t.check('уведомление гасится кнопкой, без перехода', async () => {
        // 16.10.2026: «нужна возможность отметить уведомление прочитанным, без открытия».
        const row = page.locator('[data-pf-motion-surface="popover"] li').filter({ hasText: 'Повтор заказа нужен' });
        const mark = row.getByRole('button', { name: 'Отметить прочитанным' });
        if (t.isMobile) await mark.tap(); else await mark.click();
        await t.waitForMutation((m) => m.method === 'POST' && m.path === '/notifications/n-created/read', 'уведомление не отмечено прочитанным');
        await t.visible(page.locator('[data-pf-motion-surface="popover"]'), 'окно уведомлений осталось открытым');
        if (new URL(page.url()).pathname !== '/') throw new Error('отметка прочитанным открыла задачу');
      });
      await t.check('«Для меня» прячет чужие задачи, «Все» показывает', async () => {
        // 16.10.2026: лиду приходят изменения всех задач проектов — нужен режим «только мои».
        const change = page.locator('[data-pf-motion-surface="popover"]').getByText('Обновить прайс', { exact: true });
        if (await change.count()) throw new Error('в «Для меня» видно изменение чужой задачи');
        const all = page.locator('[data-pf-motion-surface="popover"]').getByRole('tab', { name: 'Все', exact: true });
        if (t.isMobile) await all.tap(); else await all.click();
        await t.visible(change, 'изменение чужой задачи во «Все»');
      });
      await t.pageChecks('Колокольчик открыт', { bottomNav: false });
      await t.check('«Принять» принимает приглашение', async () => {
        const accept = page.getByRole('region', { name: 'Ждут ответа' }).getByRole('button', { name: 'Принять' });
        if (t.isMobile) await accept.tap(); else await accept.click();
        await t.waitForMutation((m) => m.method === 'POST' && m.path === '/invites/tok-1/accept', 'нет POST принятия приглашения');
      });
    },
  },

  {
    id: 'sidebar-project-reorder',
    title: 'Сайдбар: перетаскивание проекта не перезагружает приложение',
    matrix: [['desktop', 'light']],
    async run(t) {
      const { page } = t;
      // 16.10.2026: после броска проекта браузер переходил по ссылке строки — всё приложение
      // перезагружалось в этот проект («фризы, когда передвигаю проекты»).
      await t.goto('/', { ready: () => page.locator(NOW) });
      await page.evaluate(() => { window.__pfSameDocument = true; });
      const aside = page.locator('aside').first();
      const from = await aside.getByText('CRM-интеграция', { exact: true }).boundingBox();
      const to = await aside.getByText('Сайт клиники', { exact: true }).boundingBox();
      await t.check('бросок меняет порядок без перезагрузки и перехода', async () => {
        await page.mouse.move(from.x + 20, from.y + from.height / 2);
        await page.mouse.down();
        for (let i = 1; i <= 12; i += 1) {
          await page.mouse.move(from.x + 20, from.y + from.height / 2 + ((to.y - from.y) * i) / 12);
          await page.waitForTimeout(16);
        }
        await page.mouse.up();
        await t.waitForMutation((m) => m.method === 'PUT' && m.path === '/projects/reorder', 'нет PUT нового порядка');
        await page.waitForTimeout(500);
        const same = await page.evaluate(() => window.__pfSameDocument === true);
        if (!same) throw new Error('после броска приложение перезагрузилось');
        const path = new URL(page.url()).pathname;
        if (path !== '/') throw new Error(`после броска открылся ${path} вместо «Входящих»`);
      });
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
