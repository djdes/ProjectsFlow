import { WORKSPACE_ID } from './fixtures.mjs';

const matrix = [['desktop', 'dark'], ['phone', 'light'], ['narrow', 'dark']];
const configure = (t) => {
  t.state.telegramStatus = {
    connected: false, telegramUsername: null, telegramFirstName: null, telegramPhotoUrl: null,
    tgStarted: false, prefs: { mention: true, commentOnMyTask: true, statusChange: true },
    botUsername: 'SmokeTest_Bot', botDeepLink: 'https://t.me/SmokeTest_Bot?start=ready', botId: '123',
  };
};
const connectButton = (t) => t.page.getByRole('button', { name: 'Подключить Telegram', exact: true });

export const telegramConnectScenarios = [
  {
    id: 'telegram-connect', title: 'Telegram: подключение без внешнего виджета', matrix,
    async run(t) {
      configure(t);
      t.state.telegramStartDelay = 500;
      await t.goto('/profile', { ready: () => connectButton(t), readyName: 'подключение Telegram' });
      await t.step('подготовка ссылки с защитой от повторного нажатия', async () => {
        await connectButton(t).click();
        await t.visible(t.page.getByRole('button', { name: 'Подготавливаем ссылку…' }), 'состояние загрузки');
        t.assert(await t.page.getByRole('button', { name: 'Подготавливаем ссылку…' }).isDisabled(), 'повторный запрос доступен');
        await t.visible(t.page.getByRole('link', { name: 'Открыть Telegram', exact: true }), 'ссылка к боту');
      });
      await t.check('обычная и прямая ссылки Telegram без popup и стороннего JS', async () => {
        const web = await t.page.getByRole('link', { name: 'Открыть Telegram', exact: true }).getAttribute('href');
        const native = await t.page.getByRole('link', { name: 'Открыть в приложении', exact: true }).getAttribute('href');
        t.assert(web.startsWith('https://t.me/SmokeTest_Bot?start=connect_'), 'неправильный адрес бота');
        t.assert(native.startsWith('tg://resolve?domain=SmokeTest_Bot&start=connect_'), 'нет ссылки в приложение');
        t.assert(![...t.blockedUrls].some(u => u.includes('telegram.org')), 'клиент всё ещё загружает внешний виджет');
        t.assert(await t.page.locator('script[src*="telegram"]').count() === 0, 'остался внешний скрипт');
        const requests = t.journal.mutations.filter(m => m.path === '/me/telegram/connect/start');
        t.assert(requests.length === 1 && !requests[0].body.userId, 'привязка использует id из браузера');
      });
      await t.screenshot('telegram-awaiting-confirmation');
      await t.pageChecks('ожидание Telegram');
      await t.step('подтверждение в боте обновляет профиль после возврата', async () => {
        Object.assign(t.state.telegramStatus, { connected: true, tgStarted: true, telegramFirstName: 'Тест', telegramUsername: 'test_person' });
        await t.page.evaluate(() => window.dispatchEvent(new Event('focus')));
        await t.visible(t.page.getByText('✅ Привязан: Тест', { exact: false }), 'подключённый аккаунт');
        t.assert(await t.page.locator('[data-pf-telegram-pairing]').count() === 0, 'ожидание не завершилось');
      });
      await t.pageChecks('Telegram подключён');
    },
  },
  {
    id: 'telegram-connect-retry', title: 'Telegram: ошибка запроса и повтор', matrix,
    async run(t) {
      configure(t);
      t.state.telegramStartError = true;
      await t.goto('/profile', { ready: () => connectButton(t) });
      await connectButton(t).click();
      await t.visible(t.page.getByRole('alert').filter({ hasText: 'Не удалось создать ссылку' }), 'понятная ошибка');
      t.state.telegramStartError = false;
      await connectButton(t).click();
      await t.visible(t.page.locator('[data-pf-telegram-pairing]'), 'повтор работает');
      await t.pageChecks('после ошибки подключения');
    },
  },
  {
    id: 'telegram-connect-expired', title: 'Telegram: истечение ссылки и получение новой', matrix: [['phone', 'dark']],
    async run(t) {
      configure(t);
      t.state.telegramLinkTtl = 100;
      await t.goto('/profile', { ready: () => connectButton(t) });
      await connectButton(t).click();
      await t.visible(t.page.getByText('Срок действия ссылки истёк.', { exact: false }), 'истечение ссылки');
      t.state.telegramLinkTtl = 600_000;
      await connectButton(t).click();
      await t.visible(t.page.locator('[data-pf-telegram-pairing]'), 'новая ссылка');
      t.assert(t.state.telegramLinkSequence === 2, 'ссылка не перевыпущена');
      await t.pageChecks('новая ссылка');
    },
  },
  {
    id: 'telegram-status-retry', title: 'Telegram: ошибка статуса не означает отсутствие настройки', matrix: [['narrow', 'light']],
    async run(t) {
      configure(t);
      t.state.failReads = { [`${WORKSPACE_ID}:/me/telegram`]: { status: 503, error: 'temporary' } };
      await t.goto('/profile', { ready: () => t.page.getByRole('button', { name: 'Обновить статус' }) });
      t.assert(!(await t.page.locator('body').innerText()).includes('Подключение Telegram пока недоступно'), 'ошибка замаскирована как отсутствие бота');
      delete t.state.failReads[`${WORKSPACE_ID}:/me/telegram`];
      await t.page.getByRole('button', { name: 'Обновить статус' }).click();
      await t.visible(connectButton(t), 'статус восстановлен');
      await t.pageChecks('после восстановления статуса');
    },
  },
];
