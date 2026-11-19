import { COLLEAGUES } from './fixtures.mjs';

const [boris, vera, gleb] = COLLEAGUES;

// «Администрирование» → «Пользователи» (консоль): поиск, фильтр со счётчиками, панель
// пользователя по ссылке, массовое продление тарифа, удаление админа заблокировано, удаление
// обычного пользователя — сводка и ввод почты, продление срока тарифа из панели.
// Тариф — последним: тост об успехе на телефоне закрывает нижние строки списка.
export const adminUsersScenarios = [{
  id: 'admin-users',
  title: 'Пользователи: поиск, фильтры, панель, массовый тариф, удаление и срок тарифа',
  matrix: [['desktop', 'light'], ['phone', 'light'], ['narrow', 'dark']],
  async run(t) {
    const page = t.page;
    const row = (user) => page.locator(`[data-admin-user="${user.id}"]:visible`);
    const drawer = page.locator('[data-admin-user-drawer]');
    // Radix hides the panel from the accessibility tree while a dialog is open over it,
    // so the topmost dialog is the only visible one.
    const dialog = page.getByRole('dialog').last();
    const tap = (locator) => (t.isMobile ? locator.tap() : locator.click());
    const openDrawer = async (user) => {
      await tap(row(user).getByRole('button', { name: user.displayName }).first());
      await t.visible(drawer.getByText(user.email), `панель ${user.displayName}`);
    };
    const closeDrawer = async () => {
      await page.keyboard.press('Escape');
      await t.hidden(drawer, 'панель пользователя');
    };
    await t.goto('/admin?tab=users', { ready: () => row(boris).getByText(boris.email), readyName: 'список пользователей' });
    await t.screenshot('admin-users-console');

    await t.step('поиск по @telegram оставляет одного пользователя и попадает в адрес', async () => {
      await page.getByLabel('Поиск пользователей').fill('@vera_l');
      await t.hidden(row(boris), 'строка Бориса после поиска');
      await t.visible(row(vera), 'строка Веры');
      await t.waitFor(() => new URL(page.url()).searchParams.get('q') === '@vera_l', 'запрос не попал в адрес');
      await page.getByLabel('Поиск пользователей').fill('');
      await t.visible(row(boris), 'строка Бориса после сброса поиска');
    });

    await t.step('фильтр «Админы» со счётчиком', async () => {
      const chip = page.locator('[data-admin-filter="admins"]');
      await t.waitFor(async () => (await chip.textContent())?.includes('2'), 'счётчик админов не 2');
      await tap(chip);
      await t.hidden(row(boris), 'Борис в фильтре админов');
      await t.visible(row(gleb), 'Глеб в фильтре админов');
      t.assert(new URL(page.url()).searchParams.get('f') === 'admins', 'фильтр не попал в адрес');
      await tap(page.locator('[data-admin-filter="all"]'));
      await t.visible(row(boris), 'Борис после сброса фильтра');
    });

    await t.step('панель пользователя: открывается по строке и по ссылке, показывает данные', async () => {
      await openDrawer(boris);
      await t.visible(drawer.getByText('Сайт клиники'), 'проекты пользователя');
      await t.visible(drawer.getByText('$3.42'), 'расход ИИ');
      t.assert(new URL(page.url()).searchParams.get('user') === boris.id, 'панель не попала в адрес');
      if (t.isMobile) await t.boxFitsCheck('панель пользователя', '[data-admin-user-drawer]');
      await t.screenshot('admin-user-drawer');
      await closeDrawer();
    });

    await t.step('массово: +30 дней Прайма выбранным, запрос и запись в историю', async () => {
      for (const user of [boris, gleb]) await tap(row(user).getByRole('checkbox'));
      const bar = page.locator('[data-admin-bulk-bar]');
      await t.visible(page.getByRole('toolbar', { name: 'Действия с выбранными: 2' }), 'панель массовых действий на двоих');
      if (t.isMobile) await t.boxFitsCheck('панель массовых действий', '[data-admin-bulk-bar]');
      await t.screenshot('admin-bulk-bar');
      await tap(bar.getByRole('button', { name: 'Тариф' }));
      await t.visible(dialog.getByText(/Изменение получат 2 пользователям/), 'диалог массового тарифа');
      await dialog.getByRole('button', { name: 'Применить к 2' }).click();
      const isBulk = (x) => x.method === 'POST' && x.path === '/admin/users/bulk/plan';
      await t.waitForMutation(isBulk, 'нет запроса массового тарифа');
      const m = t.journal.mutations.find(isBulk);
      t.assert(m.body.plan === 'prime' && m.body.term.kind === 'extend' && m.body.term.days === 30
        && [...m.body.userIds].sort().join() === [boris.id, gleb.id].sort().join(), `неверный запрос: ${JSON.stringify(m.body)}`);
      await t.hidden(bar, 'панель массовых действий после применения');
      await openDrawer(gleb);
      await t.visible(drawer.locator('[data-admin-history]').getByText(/Тариф \(массово, 2 пользователя\)/), 'запись в истории действий');
    });

    await t.step('администратора удалить нельзя — объяснение вместо подтверждения', async () => {
      await drawer.getByRole('button', { name: 'Удалить пользователя' }).click();
      await t.visible(dialog.locator('[data-admin-delete-blockers]').getByText(/снимите права администратора/), 'причина блокировки');
      t.assert(await dialog.getByRole('button', { name: 'Удалить пользователя' }).isDisabled(), 'кнопка удаления активна');
      await dialog.getByRole('button', { name: 'Понятно', exact: true }).click();
      await t.visible(drawer.getByText(gleb.email), 'панель после закрытия диалога');
      await closeDrawer();
    });

    await t.step('удаление: сводка, ввод почты, пользователь пропадает из списка', async () => {
      await openDrawer(vera);
      await drawer.getByRole('button', { name: 'Удалить пользователя' }).click();
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
      await t.hidden(drawer, 'панель удалённого пользователя');
      await t.hidden(row(vera), 'строка удалённого пользователя');
    });

    await t.step('срок текущего тарифа из панели: +30 дней от даты окончания', async () => {
      // After the bulk step Boris has Prime for 35 days; the dialog extends from that end.
      await openDrawer(boris);
      await drawer.getByRole('button', { name: 'Изменить тариф' }).click();
      await t.visible(dialog.locator('[data-admin-plan-current]').getByText(/Сейчас: Прайм до .* \(35 дней\)/), 'текущий срок');
      if (t.isMobile) await t.boxFitsCheck('диалог тарифа', '[role="dialog"]');
      await dialog.getByRole('button', { name: '+30 дней' }).click();
      await dialog.getByRole('button', { name: 'Сохранить' }).click();
      const isPlan = (x) => x.method === 'PATCH' && x.path === `/admin/users/${boris.id}/plan`;
      await t.waitForMutation(isPlan, 'срок не сохранён');
      const m = t.journal.mutations.find(isPlan);
      const days = (Date.parse(m.body.subscriptionExpiresAt) - Date.now()) / 86400000;
      t.assert(m.body.plan === 'prime' && days > 64.9 && days < 65.1, `ожидали Прайм на 65 дней, пришло ${JSON.stringify(m.body)}`);
      await t.hidden(dialog.locator('[data-admin-plan-current]'), 'диалог тарифа после сохранения');
      await closeDrawer();
    });
    await t.step('рассылка выбранным: аудитория «выбранные» в форме рассылки', async () => {
      // A campaign goes out from a saved template; the console hands over only the recipients.
      t.state.mailing = { campaigns: [], reach: { eligible: 1, unsubscribed: 0, invalid: 0 }, templates: [{
        id: 'tpl-news', name: 'Новость', subject: 'Новое в ProjectsFlow', preheader: '', bodyMarkdown: 'Здравствуйте, {{name}}!',
        ctaLabel: null, ctaUrl: null, layout: 'standard', offer: null, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
      }] };
      await tap(row(boris).getByRole('checkbox'));
      // On phones the toast of the previous step covers the bar for a few seconds; the hand-off
      // is what this step checks, so the button is pressed directly.
      const mail = page.locator('[data-admin-bulk-bar]').getByRole('button', { name: 'Рассылка' });
      if (t.isMobile) await mail.evaluate((b) => b.click()); else await mail.click();
      await t.visible(page.locator('[data-pf-mailing-preset]'), 'выбранные пользователи в форме рассылки');
      await t.waitForMutation((x) => x.path === '/admin/mailings/reach' && x.body?.audience?.kind === 'users'
        && x.body.audience.userIds.join() === boris.id, 'охват по выбранным не запрошен');
    });
    t.assert(!t.journal.mutations.some((x) => x.method === 'DELETE' && x.path === `/admin/users/${gleb.id}`), 'ушёл запрос удаления админа');
    await t.pageChecks('пользователи в админке');
  },
}];
