import { addIsolationWorkspaces, COLLEAGUES, ME, WORKSPACE_ID } from './fixtures.mjs';

const matrix = [['desktop', 'light'], ['desktop', 'dark'], ['phone', 'light'], ['phone', 'dark'], ['narrow', 'dark']];
const card = (id) => `[data-pf-task-id="${id}"]`;
const section = (name) => `[data-pf-inbox-section-switch="${name}"]`;
const due = (name) => `[data-pf-due-count="${name}"]`;
const person = (t, index) => t.page.getByRole('group', { name: 'Люди', exact: true })
  .getByRole('button', { name: COLLEAGUES[index].displayName, exact: true });

async function openWorkspaceMenu(t) {
  if (t.isMobile) await t.page.getByRole('button', { name: 'Открыть меню', exact: true }).click();
  await t.page.locator(`button[title="${ME.displayName}"]`).click();
}

async function switchWorkspace(t, id, { skeleton = true } = {}) {
  const ws = t.state.workspaces.find((w) => w.id === id);
  await openWorkspaceMenu(t);
  await t.page.getByRole('button', { name: ws.name, exact: true }).click();
  if (skeleton) {
    await t.visible(t.page.locator('[data-pf-workspace-loading]'), 'скелетон смены пространства');
    t.assert(await t.page.locator('[data-pf-task-id]').count() === 0, 'прежние задачи остались под скелетоном');
    t.assert(await t.page.getByRole('group', { name: 'Люди', exact: true }).count() === 0, 'остались прежние люди');
  }
  await t.waitFor(async () => t.state.activeWorkspaceId === id && await t.page.locator('#assigned-to-me [data-pf-task-id]').count() > 0,
    `не загрузились задачи ${ws.name}`);
  await t.hidden(t.page.locator('[data-pf-workspace-loading]'), 'скелетон после загрузки');
  if (t.isMobile) await t.visible(t.page.getByRole('button', { name: 'Открыть меню', exact: true }), 'меню закрылось после смены');
}

async function start(t) {
  addIsolationWorkspaces(t.state);
  t.state.switchDelay = 450;
  await t.goto('/inbox', { ready: () => t.page.locator(card('t-form')), readyName: 'исходные входящие' });
}

async function assertOnlyWorkspace(t, id) {
  await t.waitFor(async () => {
    const ids = await t.page.locator('#assigned-to-me [data-pf-task-id]').evaluateAll((els) => els.map((e) => e.dataset.pfTaskId));
    return ids.length > 0 && ids.every((taskId) => t.state.projects.find((p) => p.id === t.state.tasks.find((task) => task.id === taskId)?.projectId)?.workspaceId === id);
  }, 'карточки другого пространства попали на экран');
  await t.waitFor(async () => t.journal.streamWorkspaces.includes(id), 'стрим уведомлений не привязан к новому пространству');
  const count = t.state.completedByWorkspace[id];
  await t.visible(t.page.locator(`[data-pf-completed-today][aria-label="Сегодня выполнено задач: ${count}"]`), 'счётчик текущего пространства');
  t.assert(t.journal.reads.some((r) => r.workspaceId === id && r.path === '/me/shared-members'), 'участники не перезагружены');
  t.assert(t.journal.reads.some((r) => r.workspaceId === id && r.path === '/assignees/mine'), 'задачи не перезагружены');
}

export const workspaceIsolationScenarios = [
  {
    id: 'workspace-isolation-load-error', title: 'Ошибка загрузки задач не маскируется пустой доской', matrix: [['desktop', 'light'], ['phone', 'dark']],
    async run(t) {
      addIsolationWorkspaces(t.state);
      t.state.failReads = { [`${WORKSPACE_ID}:/assignees/mine`]: { status: 403, error: 'temporary_access_failure' } };
      await t.goto('/inbox', { ready: () => t.page.getByText('Не удалось загрузить задачи этого пространства.', { exact: true }), readyName: 'ошибка загрузки с повтором' });
      await t.step('повтор загружает доску со скелетоном', async () => {
        delete t.state.failReads[`${WORKSPACE_ID}:/assignees/mine`];
        t.state.delays = { [`${WORKSPACE_ID}:/assignees/mine`]: 450 };
        await t.page.getByRole('button', { name: 'Повторить', exact: true }).click();
        await t.visible(t.page.locator('[data-pf-inbox-loading]'), 'скелетон повторной загрузки');
        await t.visible(t.page.locator(card('t-form')), 'задачи после восстановления');
      });
      await t.pageChecks('после повторной загрузки');
    },
  },
  {
    id: 'workspace-isolation-member-error', title: 'Ошибка доски сотрудника: понятное сообщение и повтор', matrix: [['desktop', 'dark'], ['narrow', 'light']],
    async run(t) {
      await start(t);
      t.state.failReads = { [`${WORKSPACE_ID}:/assignees/member/u-vera`]: { status: 404, error: 'workspace_not_found' } };
      await t.step('показываем ошибку вместо ложного пустого списка', async () => {
        await person(t, 1).click();
        await t.visible(t.page.getByRole('alert').filter({ hasText: 'Не удалось загрузить задачи сотрудника' }), 'ошибка сотрудника');
        t.assert(!(await t.page.locator('body').innerText()).includes('workspace_not_found'), 'техническая ошибка показана пользователю');
      });
      await t.step('повтор возвращает задачи выбранного сотрудника', async () => {
        delete t.state.failReads[`${WORKSPACE_ID}:/assignees/member/u-vera`];
        await t.page.getByRole('button', { name: 'Повторить', exact: true }).click();
        await t.waitFor(async () => await t.page.locator('#assigned-to-me [data-pf-task-id]').count() > 0, 'задачи не появились');
        const ids = await t.page.locator('#assigned-to-me [data-pf-task-id]').evaluateAll((els) => els.map((e) => e.dataset.pfTaskId));
        t.assert(ids.every((id) => t.state.tasks.find((task) => task.id === id)?.assignee.userId === 'u-vera'), 'показаны задачи другого сотрудника');
      });
      await t.pageChecks('доска сотрудника после повтора');
    },
  },
  {
    id: 'workspace-isolation-deep-link', title: 'Прямая ссылка переключает проект вместе с пространством', matrix: [['desktop', 'light'], ['phone', 'dark']],
    async run(t) {
      addIsolationWorkspaces(t.state);
      t.state.switchDelay = 350;
      await t.goto('/projects/project-ws-other', {
        ready: () => t.page.getByRole('textbox', { name: 'Название проекта' }), readyName: 'проект другой команды',
      });
      await t.check('проект и шапка относятся к одной команде', async () => {
        t.assert(t.state.activeWorkspaceId === 'ws-other', 'активное пространство осталось прежним');
        t.assert(await t.page.getByRole('textbox', { name: 'Название проекта' }).inputValue() === 'Дизайн второй команды', 'открыт другой проект');
        t.assert(t.journal.streamWorkspaces.includes('ws-other'), 'стрим остался в прежнем пространстве');
      });
      await t.step('возврат во входящие другого пространства не сохраняет проект', async () => {
        await switchWorkspace(t, WORKSPACE_ID);
        await assertOnlyWorkspace(t, WORKSPACE_ID);
        t.assert(await t.page.getByRole('textbox', { name: 'Название проекта' }).count() === 0, 'старое окно проекта осталось');
      });
      await t.pageChecks('прямая ссылка и возврат');
    },
  },
  {
    id: 'workspace-all-inboxes', title: 'Глобус: все задачи по пространствам; домик: выбранное пространство', matrix: [['desktop', 'light'], ['phone', 'dark'], ['narrow', 'light']],
    async run(t) {
      await start(t);
      const selectedBefore = t.state.activeWorkspaceId ?? WORKSPACE_ID;
      const source = t.state.tasks.find((task) => task.id === 'queue-ws-other');
      t.state.tasks.push({ ...source, id: 'colleague-invoice', description: 'Чужая накладная',
        assignee: { userId: COLLEAGUES[0].id, displayName: COLLEAGUES[0].displayName, avatarUrl: null },
        createdBy: COLLEAGUES[0].id, status: 'todo' });
      await t.goto('/all-tasks', { ready: () => t.page.getByRole('heading', { name: 'Все задачи', level: 1 }) });
      const other = t.page.locator('[data-pf-workspace-tasks="ws-other"]');
      await t.check('блоки других пространств под текущим', async () => {
        await t.visible(t.page.getByRole('heading', { name: 'Все задачи', level: 1 }), 'h1 «Все задачи»');
        await t.visible(other.getByRole('heading', { name: 'Другая команда', level: 2 }), 'блок «Другая команда»');
        await t.visible(t.page.locator('[data-pf-workspace-tasks="ws-personal"]'), 'блок личного пространства');
        if (t.isMobile) await other.locator(section('queue')).click();
        await t.visible(other.locator('[data-pf-task-id="queue-ws-other"]'), 'задача другой команды');
        t.assert(t.journal.reads.some((r) => r.workspaceId === 'ws-other' && r.path === '/assignees/mine'), 'нет запроса задач другого пространства');
        t.assert(t.state.activeWorkspaceId !== 'ws-other', 'чтение блока переключило пространство');
        t.assert(await other.locator('[data-pf-task-id="colleague-invoice"]').count() === 0, 'чужая накладная попала в «Для меня»');
        t.assert(await t.page.locator('#assigned-to-me [data-pf-task-id="queue-ws-other"]').count() === 0, 'чужая задача попала в основной блок');
      });
      await t.step('домик возвращает только выбранное пространство', async () => {
        await t.goto('/', { ready: () => t.page.getByRole('heading', { name: 'Задачи пространства', level: 1 }) });
        t.assert((t.state.activeWorkspaceId ?? WORKSPACE_ID) === selectedBefore, 'глобус изменил выбранное пространство');
        t.assert(await t.page.locator('[data-pf-task-id="queue-ws-other"]').count() === 0, 'домик показал чужое пространство');
        await t.goto('/all-tasks', { ready: () => t.page.getByRole('heading', { name: 'Все задачи', level: 1 }) });
      });
      await t.pageChecks('все задачи');
      await t.screenshot('all-inboxes');
      await t.step('карточка открывает обычное окно задачи без смены выбранного пространства', async () => {
        if (t.isMobile) await other.locator(section('queue')).click();
        await other.locator('[data-pf-task-id="queue-ws-other"]').getByText('Очередь ws-other', { exact: true }).click();
        await t.visible(t.page.getByRole('dialog').last(), 'обычное окно задачи');
        t.assert((t.state.activeWorkspaceId ?? WORKSPACE_ID) === selectedBefore, 'открытие карточки сменило выбранное пространство');
        await t.visible(t.page.getByText('Очередь ws-other', { exact: true }).filter({ visible: true }).first(), 'задача другой команды открыта');
      });
    },
  },
  {
    id: 'workspace-isolation-tab-preference', title: 'Фоновое обновление сохраняет пространство текущей вкладки', matrix: [['desktop', 'light'], ['phone', 'dark']],
    async run(t) {
      await start(t);
      await t.step('другая вкладка меняет общую настройку пространства', async () => {
        const before = t.journal.reads.filter((r) => r.path === '/projects').length;
        t.state.activeWorkspaceId = 'ws-other';
        await t.page.evaluate(() => window.dispatchEvent(new CustomEvent('pf:project-changed')));
        await t.waitFor(() => t.journal.reads.filter((r) => r.path === '/projects').length > before, 'нет фонового обновления');
        await assertOnlyWorkspace(t, WORKSPACE_ID);
        t.assert(await t.page.locator(card('manual-ws-other')).count() === 0, 'чужое пространство попало в текущую вкладку');
      });
      await t.pageChecks('после изменения настройки из другой вкладки');
    },
  },
  {
    id: 'workspace-isolation-switch', title: 'Пространства: команда → другая → личное → обратно', matrix,
    async run(t) {
      await start(t);
      await t.step('выбираем сотрудника и фильтр перед сменой', async () => {
        await person(t, 1).click();
        await t.visible(t.page.getByRole('button', { name: 'Вернуться к своим входящим' }), 'выбран сотрудник');
        await t.page.locator(due('late')).click();
      });
      for (const id of ['ws-other', 'ws-personal', WORKSPACE_ID]) {
        await t.step(`смена на ${id}: скелетон и новые данные`, async () => {
          await switchWorkspace(t, id);
          await assertOnlyWorkspace(t, id);
          t.assert(await t.page.getByRole('button', { name: 'Вернуться к своим входящим' }).count() === 0, 'выбор сотрудника сохранился');
          t.assert(await t.page.locator(due('late')).locator('..').getAttribute('aria-pressed') !== 'true', 'фильтр прошлого пространства сохранился');
        });
        await t.check(`сотрудники только из ${id}`, async () => {
          for (let i = 0; i < COLLEAGUES.length; i++) {
            const belongs = t.state.membersByWorkspace[id].some((m) => m.id === COLLEAGUES[i].id);
            t.assert((await person(t, i).count() > 0) === belongs, `неверный набор: ${COLLEAGUES[i].displayName}`);
          }
        });
        await t.pageChecks(`пространство ${id}`);
        if (id === 'ws-other') await t.screenshot('workspace-other');
      }
      await t.check('шестерёнка в меню открывает настройки другого пространства без переключения', async () => {
        const other = t.state.workspaces.find((w) => w.id === 'ws-other');
        await openWorkspaceMenu(t);
        const gear = t.page.getByRole('menuitem', { name: `Настройки пространства «${other.name}»`, exact: true });
        await t.visible(gear, 'шестерёнка видна без наведения');
        t.assert(Number(await gear.evaluate((el) => getComputedStyle(el).opacity)) === 1, 'шестерёнка прозрачная');
        await gear.click();
        await t.waitFor(() => new URL(t.page.url()).pathname === '/workspaces/ws-other/settings', 'не открылись настройки ws-other');
        t.assert(t.state.activeWorkspaceId === WORKSPACE_ID, 'клик по шестерёнке переключил пространство');
      });
    },
  },
  {
    id: 'workspace-isolation-late-response', title: 'Запоздавший ответ прежнего пространства', matrix: [['desktop', 'light'], ['phone', 'dark']],
    async run(t) {
      await start(t);
      t.state.delays = { [`${WORKSPACE_ID}:/assignees/member/u-vera`]: 2000 };
      await t.step('задерживаем задачи сотрудника', async () => {
        await person(t, 1).click();
        await t.waitFor(() => t.journal.reads.some((r) => r.path === '/assignees/member/u-vera'), 'нет запроса сотрудника');
        await t.visible(t.page.locator('#assigned-to-me [data-pf-loading]').filter({ hasText: 'Загружаем задачи…' }), 'скелетон задач сотрудника');
        t.assert(await t.page.locator('#assigned-to-me [data-pf-task-id]').count() === 0, 'старые карточки видны при загрузке сотрудника');
      });
      await t.step('меняем пространство до завершения старого запроса', () => switchWorkspace(t, 'ws-other'));
      // This pause deliberately exceeds the injected network delay; it tests a late response.
      await t.page.waitForTimeout(2200);
      await t.check('старый ответ не вернул людей, карточки и ошибки', async () => {
        await assertOnlyWorkspace(t, 'ws-other');
        t.assert(await person(t, 1).count() === 0, 'старый сотрудник вернулся');
        t.assert(!(await t.page.locator('body').innerText()).includes('workspace_not_found'), 'появилась устаревшая ошибка');
      });
      await t.pageChecks('после позднего ответа');
    },
  },
  {
    id: 'workspace-isolation-recovery', title: 'Ошибка смены пространства: восстановление и повтор', matrix: [['desktop', 'dark'], ['phone', 'light']],
    async run(t) {
      await start(t);
      t.state.failNextSwitch = true;
      await t.step('отказ сервера возвращает исходное пространство', async () => {
        await openWorkspaceMenu(t);
        await t.page.getByRole('button', { name: 'Другая команда', exact: true }).click();
        await t.visible(t.page.locator('[data-pf-workspace-loading]'), 'скелетон');
        await t.visible(t.page.locator(card('t-form')), 'исходные задачи восстановлены');
        await assertOnlyWorkspace(t, WORKSPACE_ID);
      });
      await t.step('повторное переключение работает', async () => {
        await switchWorkspace(t, 'ws-other');
        await assertOnlyWorkspace(t, 'ws-other');
      });
      await t.pageChecks('восстановление после отказа');
    },
  },
  {
    id: 'workspace-isolation-member-race', title: 'Быстрое переключение исполнителей', matrix: [['desktop', 'light'], ['phone', 'dark'], ['narrow', 'light']],
    async run(t) {
      await start(t);
      t.state.delays = { [`${WORKSPACE_ID}:/assignees/member/u-vera`]: 1500, [`${WORKSPACE_ID}:/assignees/member/u-boris`]: 350 };
      await t.step('новый сотрудник заменяет старого до ответа сервера', async () => {
        await person(t, 1).click();
        await person(t, 0).click();
        await t.visible(t.page.locator('#assigned-to-me [data-pf-loading]').filter({ hasText: 'Загружаем задачи…' }), 'скелетон сотрудника');
        await t.waitFor(async () => await t.page.locator('#assigned-to-me [data-pf-task-id]').count() > 0, 'задачи Бориса');
      });
      await t.page.waitForTimeout(1600);
      await t.check('поздний ответ Веры не заменяет задачи Бориса', async () => {
        const ids = await t.page.locator('#assigned-to-me [data-pf-task-id]').evaluateAll((els) => els.map((e) => e.dataset.pfTaskId));
        t.assert(ids.length > 0 && ids.every((id) => t.state.tasks.find((task) => task.id === id)?.assignee.userId === 'u-boris'), 'перемешались сотрудники');
      });
      await t.pageChecks('после переключения исполнителей');
    },
  },
  {
    id: 'workspace-isolation-due-counts', title: 'Сроки: счётчик соответствует видимым карточкам', matrix,
    async run(t) {
      await start(t);
      // A small complete set avoids collapsed project groups hiding cards from this assertion.
      // Reproduce the reported case: one overdue approval and one overdue queue task.
      const approval = t.state.tasks.find((task) => task.id === 'manual-ws-other');
      approval.status = 'pending_approval';
      approval.projectId = 'project-ws-other';
      approval.assignee = { userId: COLLEAGUES[2].id, displayName: COLLEAGUES[2].displayName, avatarUrl: null };
      await switchWorkspace(t, 'ws-other');
      for (const currentSection of t.isMobile ? ['now', 'queue'] : ['all']) {
        if (t.isMobile) await t.page.locator(section(currentSection)).click();
        for (const filter of ['late', 'today', 'none']) {
          await t.check(`${currentSection} / ${filter}: число = карточкам`, async () => {
            const counter = t.page.locator(due(filter));
            const expected = Number(await counter.innerText());
            await counter.click();
            await t.waitFor(async () => await t.page.locator('#assigned-to-me [data-pf-task-id]').count() === expected,
              `счётчик ${expected} не соответствует карточкам`);
            await counter.click();
          });
        }
      }
      await t.page.locator(due('late')).click();
      if (t.isMobile) await t.check('единая геометрия мобильных фильтров', async () => {
        const boxes = await Promise.all(['late', 'today', 'none'].map((f) => t.page.locator(due(f)).locator('..').boundingBox()));
        t.assert(boxes.every(Boolean), 'нет фильтра');
        const width = t.page.viewportSize().width;
        for (const b of boxes) t.assert(b.x >= 0 && b.x + b.width <= width + 1 && b.height >= 44, 'фильтр обрезан или слишком мал');
        t.assert(Math.max(...boxes.map((b) => b.width)) - Math.min(...boxes.map((b) => b.width)) < 2, 'фильтры разной ширины');
        const reset = await t.page.getByRole('button', { name: 'Сбросить фильтры', exact: true }).boundingBox();
        t.assert(reset && reset.x >= 0 && reset.x + reset.width <= width && reset.height >= 44, 'сброс обрезан');
        const search = await t.page.getByRole('button', { name: 'Поиск по проектам и задачам', exact: true }).boundingBox();
        const toggle = await t.page.locator(section('now')).boundingBox();
        t.assert(search && toggle && Math.abs(search.y + search.height / 2 - toggle.y - toggle.height / 2) < 2, 'поиск и переключатели не выровнены');
      });
      await t.screenshot('inbox-filters');
      await t.pageChecks('фильтры по срокам');
    },
  },
];
