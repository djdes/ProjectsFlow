import { ME } from './fixtures.mjs';

// «Администрирование» → «Рассылки»: template from a starter, desktop/phone preview,
// saving, a test letter to the admin (mocked POST) and the reach of a new campaign.
export const adminMailingScenarios = [{
  id: 'admin-mailing',
  title: 'Рассылки: шаблон, промо-макет, предпросмотр ПК/телефон, тест себе и охват',
  matrix: [['desktop', 'light'], ['phone', 'light']],
  async run(t) {
    const panel = t.page.locator('[data-pf-admin-mailing]');
    await t.goto('/admin?tab=mailing', { ready: () => panel.getByText('Новая рассылка'), readyName: 'раздел рассылок' });
    await t.check('вкладка «Рассылки» выбрана', () =>
      t.visible(t.page.getByRole('tab', { name: 'Рассылки', selected: true }).first(), 'активная вкладка'));

    await t.step('шаблон из заготовки', async () => {
      await panel.getByRole('tab', { name: 'Шаблоны', exact: true }).click();
      await panel.getByRole('button', { name: /Новость продукта/ }).click();
      await t.visible(panel.getByLabel('Тема письма'), 'редактор шаблона');
      await panel.getByLabel('Название шаблона').fill('Новость: доски');
      await t.visible(t.page.locator('[data-pf-mailing-body] .ProseMirror').getByText('Что нового'), 'текст заготовки в редакторе');
    });

    const preview = t.page.locator('[data-pf-mailing-preview]');
    await t.step('предпросмотр на ПК', async () => {
      await t.waitForMutation((m) => m.path === '/admin/mailings/preview' && m.body?.subject?.includes('{{name}}'), 'нет запроса предпросмотра');
      await t.visible(t.page.frameLocator('iframe[title="Письмо на компьютере"]').getByText('PROJECTSFLOW'), 'письмо в рамке ПК');
      await t.visible(t.page.getByText(`${ME.displayName}, в ProjectsFlow появилось новое`), 'тема с подставленным именем');
      await preview.scrollIntoViewIfNeeded();
    });

    await t.step('переключение на телефон', async () => {
      await t.page.getByRole('tab', { name: 'Телефон', exact: true }).click();
      await t.visible(t.page.locator('[data-pf-mailing-preview="phone"]'), 'режим телефона');
      const frame = t.page.locator('iframe[title="Письмо на телефоне"]');
      await t.visible(frame, 'рамка телефона');
      const width = await frame.evaluate((el) => el.clientWidth);
      t.assert(width === 375, `ширина вьюпорта письма ${width}px вместо 375`);
      const [box, frameBox] = [await preview.boundingBox(), await frame.boundingBox()];
      t.assert(box && frameBox && frameBox.width <= box.width + 1, 'рамка телефона шире колонки предпросмотра');
      await preview.scrollIntoViewIfNeeded();
      await t.page.getByRole('tab', { name: 'ПК', exact: true }).click();
      await t.visible(t.page.locator('[data-pf-mailing-preview="desktop"]'), 'обратно на ПК');
    });

    await t.step('промо-макет: выбор, срок акции и предпросмотр', async () => {
      const layouts = panel.locator('[data-pf-mailing-layouts]');
      await t.visible(layouts.getByRole('radio', { name: /Классика/, checked: true }), 'классический макет по умолчанию');
      await layouts.getByRole('radio', { name: /Ультрамарин/ }).click();
      await t.visible(layouts.getByRole('radio', { name: /Ультрамарин/, checked: true }), 'выбран макет «Ультрамарин»');
      await panel.getByLabel('Предложение', { exact: true }).fill('−30%');
      await panel.getByLabel('Срок', { exact: true }).fill('до 15 декабря');
      await t.waitForMutation((m) => m.path === '/admin/mailings/preview' && m.body?.layout === 'annual'
        && m.body?.offer?.badge === '−30%' && m.body?.offer?.deadline === 'до 15 декабря', 'предпросмотр не получил макет и акцию');
      const desktop = t.page.frameLocator('iframe[title="Письмо на компьютере"]');
      await t.visible(desktop.locator('[data-pf-layout="annual"]'), 'макет в письме');
      await t.visible(desktop.locator('.pf-offer').getByText('−30%'), 'предложение крупной строкой');
      await t.page.getByRole('tab', { name: 'Телефон', exact: true }).click();
      await t.visible(t.page.frameLocator('iframe[title="Письмо на телефоне"]').locator('[data-pf-layout="annual"]'), 'макет на телефоне');
      await t.page.getByRole('tab', { name: 'ПК', exact: true }).click();
      await t.visible(t.page.locator('[data-pf-mailing-preview="desktop"]'), 'обратно на ПК');
    });

    await t.step('сохранение и тест себе', async () => {
      await panel.getByRole('button', { name: 'Сохранить', exact: true }).click();
      await t.waitForMutation((m) => m.method === 'POST' && m.path === '/admin/mailings/templates' && m.body?.name === 'Новость: доски'
        && m.body?.layout === 'annual' && m.body?.offer?.badge === '−30%', 'шаблон не сохранён');
      await panel.getByRole('button', { name: 'Отправить тест себе', exact: true }).click();
      await t.waitForMutation((m) => m.path === '/admin/mailings/test', 'тест не отправлен');
      await t.visible(t.page.getByText(`Тестовое письмо отправлено на ${ME.email}`), 'подтверждение теста');
    });

    await t.step('рассылка из шаблона: охват', async () => {
      await panel.getByRole('button', { name: 'Создать рассылку', exact: true }).click();
      await t.waitForMutation((m) => m.path === '/admin/mailings/reach' && m.body?.audience?.kind === 'all', 'охват не запрошен');
      const reach = t.page.locator('[data-pf-mailing-reach]');
      await t.visible(reach.getByText('Получат письмо:'), 'охват');
      await t.visible(reach.getByText('отписались: 1'), 'исключённые отписавшиеся');
      await panel.getByRole('tab', { name: 'Тариф', exact: true }).click();
      await t.waitForMutation((m) => m.path === '/admin/mailings/reach' && m.body?.audience?.kind === 'plan', 'охват по тарифу не запрошен');
      await t.visible(t.page.getByRole('button', { name: 'Запустить', exact: true }), 'кнопка запуска');
    });

    await t.pageChecks('рассылки');
  },
}];
