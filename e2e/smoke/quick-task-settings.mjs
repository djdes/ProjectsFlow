import { addIsolationWorkspaces, BOARD_PROJECT_ID, COLLEAGUES, ME, WORKSPACE_ID } from './fixtures.mjs';

const activate = (t, locator) => t.isMobile ? locator.tap() : locator.click();
const composer = (t) => t.page.locator('[data-pf-inline-create]');
const writes = (t) => t.journal.mutations.filter((m) => m.method === 'POST' && m.path.endsWith('/tasks'));
const menuClosed = (t) => t.hidden(t.page.locator('[role="menu"]'), 'шторка закрылась');
const matrix = [['desktop', 'light'], ['phone', 'light'], ['phone', 'dark'], ['narrow', 'dark']];

export const quickTaskSettingsScenarios = [
  {
    id: 'quick-task-settings', title: 'Настройки под названием: выбор, отмена и последовательное создание', matrix,
    async run(t) {
      const { page } = t;
      await page.clock.setFixedTime(new Date('2026-10-14T09:00:00+03:00'));
      t.state.tasks.find((task) => task.id === 't-prices').deadline = '2026-10-14';
      await t.goto('/', { ready: () => page.getByRole('group', { name: 'Люди', exact: true }) });
      await activate(t, page.getByRole('group', { name: 'Люди', exact: true }).getByRole('button', { name: COLLEAGUES[1].displayName, exact: true }));
      await t.visible(page.getByRole('button', { name: 'Вернуться к своим входящим' }), 'выбран сотрудник');
      if (t.isMobile) await activate(t, page.locator('[data-pf-inbox-section-switch="queue"]'));
      await activate(t, page.getByRole('group', { name: 'Срок', exact: true }).getByRole('button', { name: /^Сегодня/ }));
      await activate(t, page.getByRole('button', { name: 'Создать задачу в проекте', exact: true }).first());
      const field = composer(t).getByRole('textbox', { name: 'Название задачи', exact: true });
      await t.step('исполнитель и срок взяты из контекста до ввода', async () => {
        await t.visible(composer(t).getByRole('button', { name: `Исполнитель: ${COLLEAGUES[1].displayName}`, exact: true }), 'исполнитель по фильтру');
        t.assert(await composer(t).locator('input[type="date"]').inputValue() === '2026-10-14', 'фильтр Сегодня не учтён');
        await t.visible(composer(t).getByRole('group', { name: 'Настройки новой задачи' }), 'настройки под полем');
        if (t.isMobile) t.assert(await page.getByRole('button', { name: 'Новая задача', exact: true }).count() === 0, 'плавающая кнопка перекрывает настройки');
        await t.boxFitsCheck('inline-карточка', '[data-pf-inline-create]');
        await field.fill('Настройки до создания');
        await t.screenshot('inline-defaults');
      });
      await t.step('шторки меняют настройки без создания по blur', async () => {
        await activate(t, composer(t).getByRole('button', { name: `Исполнитель: ${COLLEAGUES[1].displayName}`, exact: true }));
        await activate(t, page.getByRole('menuitemradio', { name: new RegExp(COLLEAGUES[0].displayName) }));
        await menuClosed(t);
        await activate(t, composer(t).getByRole('button', { name: 'Срок: 2026-10-14', exact: true }));
        await activate(t, page.getByRole('menuitem', { name: 'Очистить срок', exact: true }));
        await menuClosed(t);
        await activate(t, composer(t).getByRole('button', { name: 'Приоритет задачи', exact: true }));
        await activate(t, page.getByRole('menuitem', { name: 'Срочно', exact: true }));
        await menuClosed(t);
        t.assert(writes(t).length === 0, 'открытие настройки создало задачу');
        t.assert(await field.inputValue() === 'Настройки до создания', 'текст потерян при выборе');
        await t.visible(composer(t).getByRole('button', { name: `Исполнитель: ${COLLEAGUES[0].displayName}`, exact: true }), 'ручной выбор исполнителя');
        await t.screenshot('inline-edited');
      });
      await t.step('отмена не создаёт, повторное открытие возвращает актуальные defaults', async () => {
        await activate(t, composer(t).getByRole('button', { name: 'Отменить создание' }));
        await t.hidden(composer(t), 'карточка отменена');
        t.assert(writes(t).length === 0, 'отмена сохранила задачу');
        await activate(t, page.getByRole('button', { name: 'Создать задачу в проекте', exact: true }).first());
        await t.visible(composer(t).getByRole('button', { name: `Исполнитель: ${COLLEAGUES[1].displayName}`, exact: true }), 'контекст восстановлен');
        await field.fill('Создано с настройками');
        await activate(t, composer(t).getByRole('button', { name: 'Срок: 2026-10-14', exact: true }));
        await activate(t, page.getByRole('menuitem', { name: 'Завтра', exact: true }));
        await menuClosed(t);
        await activate(t, composer(t).getByRole('button', { name: 'Создать', exact: true }));
        await t.waitForMutation((m) => m.method === 'POST' && m.path === `/projects/${BOARD_PROJECT_ID}/tasks` && m.body?.description === 'Создано с настройками' && m.body?.deadline === '2026-10-15' && m.body?.assigneeUserId === COLLEAGUES[1].id && m.body?.status === 'backlog', 'настройки не переданы при создании');
        await t.waitFor(async () => await field.inputValue() === '', 'поле не очищено');
        await field.fill('Вторая задача с теми же настройками');
        await field.press('Enter');
        await t.waitFor(() => writes(t).length === 2, 'повторное создание потеряно или продублировано');
        t.assert(writes(t).every((m) => m.body.deadline === '2026-10-15'), 'явно выбранный срок сброшен после первого создания');
      });
      await t.step('смена исполнителя показывает созданную задачу в его входящих', async () => {
        await field.fill('Передано себе из доски сотрудника');
        await activate(t, composer(t).getByRole('button', { name: `Исполнитель: ${COLLEAGUES[1].displayName}`, exact: true }));
        await activate(t, page.getByRole('menuitemradio', { name: new RegExp(ME.displayName) }));
        await menuClosed(t);
        await activate(t, composer(t).getByRole('button', { name: 'Создать', exact: true }));
        await t.waitFor(() => writes(t).length === 3, 'изменённый исполнитель не сохранён');
        const saved = t.state.tasks.find((task) => task.description === 'Передано себе из доски сотрудника');
        t.assert(saved?.assignee.userId === ME.id, 'задача создана не на выбранного исполнителя');
        await t.visible(page.locator(`[data-pf-task-id="${saved.id}"]`), 'новая задача видна после смены фильтра');
      });
      await t.pageChecks('после создания с настройками');
    },
  },
  {
    id: 'quick-workspace-switch', title: 'Быстрая смена пространства из шапки',
    matrix: [['phone', 'light'], ['phone', 'dark'], ['narrow', 'dark']],
    async run(t) {
      addIsolationWorkspaces(t.state);
      t.state.switchDelay = 450;
      const { page } = t;
      await t.goto('/inbox', { ready: () => page.locator('[data-pf-task-id]:visible') });
      for (const target of ['ws-other', 'ws-personal', WORKSPACE_ID]) {
        const ws = t.state.workspaces.find((item) => item.id === target);
        await t.step(`шапка → ${ws.name}`, async () => {
          const trigger = page.getByRole('button', { name: /^Сменить пространство:/ });
          t.assert(await trigger.locator('svg.lucide-chevron-down').isVisible(), 'стрелка переключения скрыта');
          const box = await trigger.boundingBox();
          t.assert(box && box.height >= 44, 'маленькая зона нажатия');
          await activate(t, trigger);
          await t.visible(page.getByRole('menuitemradio', { checked: true }), 'отмечено текущее пространство');
          await t.boxFitsCheck('выбор пространства', '[role="menu"]');
          if (target === 'ws-other') await t.screenshot('workspace-picker');
          await activate(t, page.getByRole('menuitemradio', { name: ws.name, exact: true }));
          await t.visible(page.locator('[data-pf-workspace-loading]'), 'скелетон смены');
          t.assert(await page.locator('[data-pf-task-id]').count() === 0, 'старые задачи видны при смене');
          await t.visible(page.getByRole('button', { name: `Сменить пространство: ${ws.name}`, exact: true }), 'название нового пространства');
          await t.waitFor(async () => await page.locator('#assigned-to-me [data-pf-task-id]').count() > 0, 'задачи не загрузились');
          const ids = await page.locator('#assigned-to-me [data-pf-task-id]').evaluateAll((els) => els.map((el) => el.dataset.pfTaskId));
          t.assert(ids.every((id) => t.state.projects.find((project) => project.id === t.state.tasks.find((task) => task.id === id)?.projectId)?.workspaceId === target), 'смешаны задачи пространств');
        });
      }
      await t.step('профиль визуально кликабелен и открывает меню', async () => {
        await activate(t, page.getByRole('button', { name: 'Открыть меню', exact: true }));
        const profile = page.locator(`button[title="${ME.displayName}"]`);
        t.assert(await profile.locator('svg.lucide-chevrons-up-down').evaluate((el) => getComputedStyle(el).opacity === '1'), 'стрелка профиля появляется только по hover');
        await t.screenshot('sidebar-profile');
        await activate(t, profile);
        await t.visible(page.getByRole('menuitem', { name: 'Настройки', exact: true }), 'меню профиля');
      });
      await t.pageChecks('после переключения');
    },
  },
];
