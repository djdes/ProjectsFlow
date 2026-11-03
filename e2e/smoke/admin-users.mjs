import { COLLEAGUES } from './fixtures.mjs';

const [boris, vera, gleb] = COLLEAGUES;

// «Администрирование» → «Пользователи»: удаление админа заблокировано, удаление обычного
// пользователя — сводка и ввод почты, продление срока текущего тарифа без смены тарифа.
// Тариф — последним: тост об успехе на телефоне закрывает нижние строки списка.
export const adminUsersScenarios = [{
  id: 'admin-users',
  title: 'Пользователи: продление срока тарифа, сводка удаления и подтверждение почтой',
  matrix: [['desktop', 'light'], ['phone', 'light'], ['narrow', 'dark']],
  async run(t) {
    const row = (user) => t.page.locator(`[data-admin-user="${user.id}"]`);
    const dialog = t.page.getByRole('dialog');
    await t.goto('/admin?tab=users', { ready: () => row(boris).getByText(boris.email), readyName: 'список пользователей' });

    await t.step('администратора удалить нельзя — объяснение вместо подтверждения', async () => {
      await row(gleb).getByRole('button', { name: 'Удалить' }).click();
      await t.visible(dialog.locator('[data-admin-delete-blockers]').getByText(/снимите права администратора/), 'причина блокировки');
      t.assert(await dialog.getByRole('button', { name: 'Удалить пользователя' }).isDisabled(), 'кнопка удаления активна');
      await dialog.getByRole('button', { name: 'Понятно', exact: true }).click();
      await t.hidden(dialog, 'диалог блокировки');
    });

    await t.step('удаление: сводка, ввод почты, пользователь пропадает из списка', async () => {
      await row(vera).getByRole('button', { name: 'Удалить' }).click();
      const summary = dialog.locator('[data-admin-delete-summary]');
      await t.visible(summary.getByText(/2 проекта .* 7 задач/), 'что будет удалено');
      await t.visible(summary.getByText(/3 задачи перейдут/), 'что перейдёт команде');
      if (t.isMobile) await t.boxFitsCheck('диалог удаления', '[role="dialog"]');
      await t.screenshot('admin-delete-dialog');
      const confirm = dialog.getByRole('button', { name: 'Удалить пользователя' });
      await dialog.getByLabel(/Для подтверждения введите/).fill('wrong@smoke.test');
      t.assert(await confirm.isDisabled(), 'удаление доступно с чужой почтой');
      await dialog.getByLabel(/Для подтверждения введите/).fill(vera.email.toUpperCase());
      await confirm.click();
      await t.waitForMutation((x) => x.method === 'DELETE' && x.path === `/admin/users/${vera.id}`, 'нет запроса удаления');
      await t.hidden(dialog, 'диалог удаления');
      await t.hidden(row(vera), 'строка удалённого пользователя');
    });

    await t.step('срок текущего тарифа: +30 дней от даты окончания', async () => {
      await row(boris).getByRole('button', { name: 'Тариф и срок' }).click();
      await t.visible(dialog.locator('[data-admin-plan-current]').getByText(/Сейчас: Прайм до .* \(5 дней\)/), 'текущий срок');
      if (t.isMobile) await t.boxFitsCheck('диалог тарифа', '[role="dialog"]');
      await t.screenshot('admin-plan-dialog');
      await dialog.getByRole('button', { name: '+30 дней' }).click();
      await dialog.getByRole('button', { name: 'Сохранить' }).click();
      const isPlan = (x) => x.method === 'PATCH' && x.path === `/admin/users/${boris.id}/plan`;
      await t.waitForMutation(isPlan, 'срок не сохранён');
      const m = t.journal.mutations.find(isPlan);
      const days = (Date.parse(m.body.subscriptionExpiresAt) - Date.now()) / 86400000;
      t.assert(m.body.plan === 'prime' && days > 34.9 && days < 35.1, `ожидали Прайм на 35 дней, пришло ${JSON.stringify(m.body)}`);
      await t.hidden(dialog, 'диалог тарифа после сохранения');
    });
    t.assert(!t.journal.mutations.some((x) => x.method === 'DELETE' && x.path === `/admin/users/${gleb.id}`), 'ушёл запрос удаления админа');
    await t.pageChecks('пользователи в админке');
  },
}];
