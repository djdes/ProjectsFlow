import { BOARD_PROJECT_ID, COLLEAGUES, ME, WORKSPACE_ID } from './fixtures.mjs';

const dialog = (page) => page.getByRole('dialog', { name: 'Новая задача', exact: true });
const person = (page, member) => page.getByRole('group', { name: 'Люди', exact: true })
  .getByRole('button', { name: member.displayName, exact: true });
const createButton = (page) => page.getByRole('button', { name: /^(Задача|Новая задача|Добавить задачу)$/ }).filter({ visible: true }).first();
const assigneeButton = (page, member) => dialog(page).getByRole('button', { name: `Исполнитель: ${member.displayName}`, exact: true });
const activate = (t, locator) => t.isMobile ? locator.tap() : locator.click();
const menuClosed = (t) => t.hidden(t.page.locator('[role="menu"]'), 'меню закрылось');
async function closeMenu(t) {
  await t.page.keyboard.press('Escape');
  await menuClosed(t);
}
async function closeForm(t) {
  await activate(t, dialog(t.page).locator('[data-pf-window-close]'));
  await t.hidden(t.page.locator('[role="dialog"]'), 'форма закрылась');
}

async function openCreate(t, member, deadline) {
  await activate(t, createButton(t.page));
  await t.visible(dialog(t.page), 'форма создания');
  await t.visible(dialog(t.page).locator('[contenteditable="true"]'), 'редактор загрузился');
  if (!t.isMobile) await t.waitFor(() => dialog(t.page).locator('[contenteditable="true"]').evaluate((el) => el.contains(document.activeElement)), 'начальный фокус редактора');
  await t.visible(assigneeButton(t.page, member), 'исполнитель из фильтра');
  t.assert(await dialog(t.page).locator('input[type="date"]').inputValue() === deadline, 'неверный срок по умолчанию');
}

async function checkSelected(t, member) {
  await activate(t, assigneeButton(t.page, member));
  await t.visible(t.page.locator('[role="menu"][data-state="open"]'), 'меню исполнителя');
  const checked = t.page.getByRole('menuitemradio', { checked: true });
  t.assert(await checked.count() === 1, 'должен быть выбран ровно один исполнитель');
  t.assert((await checked.innerText()).includes(member.displayName), 'галка стоит у другого сотрудника');
  await t.visible(checked.locator('svg.lucide-check'), 'галка выбранного исполнителя');
}

export const taskCreationDefaultsScenarios = [
  {
    id: 'task-create-inline', title: 'Быстрое создание в колонке проекта получает срок',
    matrix: [['desktop', 'light'], ['phone', 'dark']],
    async run(t) {
      const { page } = t;
      await page.clock.setFixedTime(new Date('2026-10-16T09:00:00+03:00'));
      await t.goto(`/projects/${BOARD_PROJECT_ID}`, { ready: () => page.locator('[data-pf-kanban-column]') });
      await t.step('Enter создаёт задачу со сроком в следующее воскресенье', async () => {
        const column = page.locator('[data-pf-column-status="backlog"]');
        await activate(t, column.getByRole('button', { name: 'Добавить задачу', exact: true }));
        const field = page.getByRole('textbox', { name: 'Название задачи', exact: true });
        await field.fill('Задача из колонки со сроком');
        await field.press('Enter');
        await t.waitForMutation((m) => m.method === 'POST' && m.path === `/projects/${BOARD_PROJECT_ID}/tasks` && m.body?.description === 'Задача из колонки со сроком' && m.body?.deadline === '2026-10-25', 'быстрое создание отправлено без срока');
      });
      await t.pageChecks('после быстрого создания');
    },
  },
  {
    id: 'task-create-defaults', title: 'Создание: исполнитель, галка, срок и черновик',
    matrix: [['desktop', 'light'], ['desktop', 'dark'], ['phone', 'light'], ['phone', 'dark'], ['narrow', 'dark']],
    async run(t) {
      const { page } = t;
      await page.clock.setFixedTime(new Date('2026-10-14T09:00:00+03:00'));
      await t.goto('/', { ready: () => person(page, COLLEAGUES[1]) });
      await person(page, COLLEAGUES[1]).click();
      await t.visible(page.getByRole('button', { name: 'Вернуться к своим входящим' }), 'фильтр сотрудника');
      await t.step('среда: сотрудник из фильтра и это воскресенье', async () => {
        await openCreate(t, COLLEAGUES[1], '2026-10-18');
        await checkSelected(t, COLLEAGUES[1]);
        await t.boxFitsCheck('меню исполнителя', '[role="menu"]');
        await t.screenshot('selected-assignee');
        await closeMenu(t);
        await t.visible(dialog(page), 'меню закрылось, форма осталась');
      });
      await t.step('ручной выбор и очищенный срок переживают смену проекта и черновик', async () => {
        await checkSelected(t, COLLEAGUES[1]);
        await activate(t, page.getByRole('menuitemradio', { name: new RegExp(COLLEAGUES[0].displayName) }));
        await menuClosed(t);
        await activate(t, dialog(page).getByRole('button', { name: 'Без проекта (Входящие)', exact: true }));
        await activate(t, page.getByRole('menuitemradio', { name: 'Сайт клиники', exact: true }));
        await menuClosed(t);
        await checkSelected(t, COLLEAGUES[0]);
        await closeMenu(t);
        await dialog(page).locator('[contenteditable="true"]').fill('Проверка черновика без срока');
        await activate(t, dialog(page).getByRole('button', { name: 'Срок: 2026-10-18', exact: true }));
        await activate(t, page.getByRole('menuitem', { name: 'Очистить срок', exact: true }));
        await menuClosed(t);
        await closeForm(t);
        await page.clock.setFixedTime(new Date('2026-10-15T09:00:00+03:00'));
        await openCreate(t, COLLEAGUES[1], '2026-10-25');
        // Untouched opening must not overwrite the previous meaningful draft.
        await closeForm(t);
        await openCreate(t, COLLEAGUES[1], '2026-10-25');
        await dialog(page).getByRole('button', { name: /Восстановить/ }).click();
        await checkSelected(t, COLLEAGUES[0]);
        await closeMenu(t);
        t.assert(await dialog(page).locator('input[type="date"]').inputValue() === '', 'очищенный срок заменён автоматическим');
        await dialog(page).getByRole('button', { name: 'Добавить', exact: true }).click();
        await t.waitForMutation((m) => m.method === 'POST' && m.path.endsWith('/tasks') && m.body?.description === 'Проверка черновика без срока' && m.body?.assigneeUserId === COLLEAGUES[0].id && m.body?.deadline === null, 'ручные значения не отправлены');
        await t.hidden(dialog(page), 'форма после создания');
      });
      await t.pageChecks('после создания');
    },
  },
  {
    id: 'task-create-filter', title: 'Создание: обычный фильтр, сброс и ошибка списка сотрудников',
    matrix: [['desktop', 'light'], ['phone', 'dark']],
    async run(t) {
      const { page } = t;
      await page.clock.setFixedTime(new Date('2026-10-18T09:00:00+03:00'));
      await t.goto('/', { ready: () => person(page, COLLEAGUES[0]) });
      await page.getByRole('group', { name: 'Чьи задачи', exact: true }).getByRole('button', { name: /^Все/ }).click();
      await page.getByRole('button', { name: 'Фильтры', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: COLLEAGUES[0].displayName, exact: true }).click();
      await page.keyboard.press('Escape');
      await t.step('обычный фильтр и срок следующего воскресенья отправляются на сервер', async () => {
        await openCreate(t, COLLEAGUES[0], '2026-10-25');
        await checkSelected(t, COLLEAGUES[0]);
        await closeMenu(t);
        await dialog(page).locator('[contenteditable="true"]').fill('Задача для выбранного сотрудника');
        await dialog(page).getByRole('button', { name: 'Добавить', exact: true }).click();
        await t.waitForMutation((m) => m.method === 'POST' && m.path.endsWith('/tasks') && m.body?.description === 'Задача для выбранного сотрудника' && m.body?.assigneeUserId === COLLEAGUES[0].id && m.body?.deadline === '2026-10-25', 'значения по умолчанию не отправлены');
        await t.hidden(dialog(page), 'форма после создания');
      });
      await t.step('без фильтра выбирается текущий пользователь', async () => {
        await page.getByRole('group', { name: 'Чьи задачи', exact: true }).getByRole('button', { name: /^Мои/ }).click();
        await openCreate(t, ME, '2026-10-25');
        await checkSelected(t, ME);
        await closeMenu(t);
        await closeForm(t);
      });
      await t.step('ошибка загрузки не сбрасывает выбор, повтор восстанавливает меню', async () => {
        await person(page, COLLEAGUES[1]).click();
        const key = `${WORKSPACE_ID}:/me/shared-members`;
        t.state.failReads = { [key]: { status: 503, error: 'temporary_member_failure' } };
        await activate(t, createButton(page));
        await t.visible(dialog(page).locator('[contenteditable="true"]'), 'редактор загрузился');
        await activate(t, dialog(page).getByRole('button', { name: 'Выбрать исполнителя', exact: true }));
        await t.visible(page.getByRole('alert').filter({ hasText: 'Не удалось загрузить участников.' }), 'ошибка загрузки участников');
        delete t.state.failReads[key];
        t.state.delays = { [key]: 450 };
        await activate(t, page.getByRole('menuitem', { name: 'Повторить', exact: true }));
        await t.visible(page.getByRole('status').filter({ hasText: 'Загрузка участников…' }), 'загрузка участников');
        const selected = page.getByRole('menuitemradio', { checked: true }).filter({ hasText: COLLEAGUES[1].displayName });
        await t.visible(selected.locator('svg.lucide-check'), 'повтор сохранил исполнителя');
        await closeMenu(t);
        await closeForm(t);
      });
      await t.pageChecks('после проверки фильтра');
    },
  },
];
