// Run after motion-browser-fixture.js and app-fluidity-browser-fixture.js, on local synthetic data.
async (page) => {
  const base = 'http://127.0.0.1:5184';
  const folder = 'C:/www/ProjectsFlow/reference/app-fluidity/actual/';
  const checks = [],
    geometry = [],
    errors = [];
  const onError = (error) => errors.push(error.message);
  page.on('pageerror', onError);
  const check = (name, passed, detail) => {
    checks.push({ name, passed: Boolean(passed), detail });
    if (!passed) throw new Error(name + ': ' + JSON.stringify(detail));
  };
  const control = (values) =>
    page.evaluate(
      (values) =>
        fetch('/api/fixture/control', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(values),
        }),
      values,
    );
  const state = () =>
    page.evaluate(() => fetch('/api/fixture/state').then((r) => r.json()));
  const cdp = await page.context().newCDPSession(page);
  const touch = async (from, to, cancel = false) => {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: from.x, y: from.y, id: 1 }],
    });
    for (let step = 1; step <= 8; step++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          {
            x: from.x + ((to.x - from.x) * step) / 8,
            y: from.y + ((to.y - from.y) * step) / 8,
            id: 1,
          },
        ],
      });
      await page.waitForTimeout(35);
    }
    await cdp.send('Input.dispatchTouchEvent', {
      type: cancel ? 'touchCancel' : 'touchEnd',
      touchPoints: [],
    });
  };
  try {
    await page.emulateMedia({
      reducedMotion: 'no-preference',
      colorScheme: 'light',
    });
    await page.evaluate(() =>
      document.documentElement.classList.remove('dark'),
    );
    await page.evaluate(() =>
      fetch('/__fixture/media-control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fail: true }),
      }),
    );
    await control({
      delay: 0,
      authDelay: 0,
      taskDelay: 0,
      failPath: null,
      empty: false,
    });
    await cdp.send('Emulation.setTouchEmulationEnabled', {
      enabled: true,
      maxTouchPoints: 5,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    let profileImports = 0;
    const slowProfile = async (route) => {
      profileImports++;
      await new Promise((resolve) => setTimeout(resolve, 900));
      await route.continue();
    };
    await page.route('**/src/presentation/pages/ProfilePage.tsx*', slowProfile);
    await page.goto(base + '/projects/access-p0?view=default');
    await page.locator('[data-pf-task-id="format-t0"]').waitFor();
    for (let i = 0; i < 3; i++) await page.keyboard.press('Escape');
    const main = page.locator('main[data-pf-main]');
    await main.evaluate((e) => (e.scrollTop = 150));
    await page.waitForTimeout(100);
    // Focus preloads code without navigating or loading private page data.
    const before = (await state()).requests.length;
    await page.getByRole('button', { name: 'Профиль', exact: true }).focus();
    await page.waitForTimeout(140);
    check(
      'focus preloads destination code',
      profileImports === 1,
      profileImports,
    );
    check(
      'prefetch does not navigate',
      new URL(page.url()).pathname.endsWith('access-p0'),
    );
    check(
      'prefetch does not fetch page data',
      !(await state()).requests
        .slice(before)
        .some((r) => /\/agent\/|\/auth\//.test(r.path)),
    );
    await page.getByRole('button', { name: 'Профиль', exact: true }).click();
    await page
      .getByRole('progressbar', { name: 'Открываем страницу' })
      .waitFor();
    await page.waitForTimeout(180);
    await page.screenshot({ path: folder + 'navigation-loading.png' });
    await page.getByRole('heading', { name: 'Профиль', exact: true }).waitFor();
    check(
      'new destination starts at top',
      (await main.evaluate((e) => e.scrollTop)) === 0,
    );
    await main.evaluate((e) => (e.scrollTop = 350));
    await page.waitForTimeout(100);
    await page.getByRole('button', { name: 'Профиль', exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector('main[data-pf-main]').scrollTop < 1,
    );
    check('repeat active tab scrolls to top', true);
    await main.evaluate((e) => (e.scrollTop = 350));
    await page.waitForTimeout(100);
    await control({ taskDelay: 650 });
    await page.goBack();
    await page.locator('[data-pf-task-id="format-t0"]').waitFor();
    await page.waitForTimeout(900);
    check(
      'Back restores scroll after delayed task data',
      (await main.evaluate((e) => e.scrollTop)) === 150,
      await main.evaluate((e) => e.scrollTop),
    );
    await page.goForward();
    await page.getByRole('heading', { name: 'Профиль', exact: true }).waitFor();
    await page.waitForTimeout(400);
    check(
      'Forward restores profile position',
      (await main.evaluate((e) => e.scrollTop)) === 350,
    );
    await page.goBack();
    await page.locator('[data-pf-task-id="format-t0"]').waitFor();
    await page.waitForTimeout(500);
    await page.unroute(
      '**/src/presentation/pages/ProfilePage.tsx*',
      slowProfile,
    );
    await main.evaluate((e) => (e.scrollTop = 0));
    const taskReads = async () =>
      (await state()).requests.filter(
        (r) => r.path === '/projects/access-p0/tasks' && r.method === 'GET',
      ).length;
    const initialReads = await taskReads();
    await touch({ x: 12, y: 320 }, { x: 12, y: 510 }, true);
    await page.waitForTimeout(150);
    check(
      'cancelled pull sends no refresh',
      (await taskReads()) === initialReads,
    );
    await touch({ x: 12, y: 320 }, { x: 140, y: 340 });
    await page.waitForTimeout(150);
    check(
      'horizontal gesture sends no refresh',
      (await taskReads()) === initialReads,
    );
    // The existing edge gesture may open the navigation drawer; dismiss it before pulling.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    await touch({ x: 12, y: 320 }, { x: 12, y: 510 });
    check(
      'pull enters refreshing state',
      (await page.locator('.pf-pull-refresh').innerText()).includes(
        'Обновляем',
      ),
    );
    check(
      'refresh preserves rendered cards',
      await page.locator('[data-pf-task-id="format-t0"]').isVisible(),
    );
    await page.screenshot({ path: folder + 'pull-refresh.png' });
    await page.getByText('Обновлено', { exact: true }).waitFor();
    check(
      'one pull makes one task list request',
      (await taskReads()) === initialReads + 1,
    );
    await control({ failPath: '/projects/access-p0/tasks', taskDelay: 0 });
    await page
      .getByRole('button', { name: 'Обновить страницу', exact: true })
      .focus();
    await page.keyboard.press('Enter');
    await page
      .getByText('Не удалось обновить данные. Попробуйте ещё раз.', {
        exact: true,
      })
      .waitFor();
    check(
      'failed refresh keeps cards',
      await page.locator('[data-pf-task-id="format-t0"]').isVisible(),
    );
    await control({ failPath: null });
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        get: () => false,
      });
      window.dispatchEvent(new Event('offline'));
    });
    await page
      .getByText('Нет соединения с интернетом', { exact: true })
      .waitFor();
    check('offline indicator appears', true);
    await page.waitForTimeout(400);
    const notice = await page.locator('.pf-connection-notice').boundingBox();
    const toastBox = await page
      .locator('[data-sonner-toast]')
      .last()
      .boundingBox();
    check(
      'connection notice and toast do not overlap',
      toastBox.y + toastBox.height < notice.y,
      { notice, toastBox },
    );
    check(
      'failed refresh does not retain success label',
      !(await page.locator('.pf-pull-refresh').innerText()).includes(
        'Обновлено',
      ),
    );
    await page.screenshot({ path: folder + 'offline.png' });
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        get: () => true,
      });
      window.dispatchEvent(new Event('online'));
    });
    await page.getByText('Соединение восстановлено', { exact: true }).waitFor();
    await page.getByText('Обновлено', { exact: true }).waitFor();
    check('reconnection refreshes current reads', true);
    await page.locator('[data-pf-task-id="format-t0"]').click();
    await page
      .getByRole('button', {
        name: 'Открыть Главная страница.png',
        exact: true,
      })
      .click();
    const gallery = page.locator('.pf-gallery');
    await gallery
      .getByRole('heading', { name: 'Главная страница.png', exact: true })
      .waitFor();
    await gallery.locator('img').waitFor();
    await page.waitForTimeout(450);
    await page.keyboard.press('ArrowRight');
    await gallery
      .getByRole('heading', { name: 'Каталог товаров.png', exact: true })
      .waitFor();
    check('gallery keyboard advances media and accessible title', true);
    const stage = await page.locator('.pf-gallery-stage').boundingBox();
    await touch(
      { x: stage.x + 40, y: stage.y + 100 },
      { x: stage.x + stage.width - 40, y: stage.y + 102 },
    );
    await gallery
      .getByRole('heading', { name: 'Главная страница.png', exact: true })
      .waitFor();
    check(
      'gallery swipe changes image without dismissing sheet',
      await gallery.isVisible(),
    );
    await gallery
      .getByRole('button', { name: 'Увеличить изображение', exact: true })
      .click();
    check(
      'zoom enables native image panning',
      await page
        .locator('.pf-gallery-image')
        .evaluate((e) => e.scrollWidth > e.clientWidth && e.scrollLeft > 0),
    );
    await gallery
      .getByRole('button', { name: 'Уменьшить изображение', exact: true })
      .click();
    const imageBox = await gallery.locator('img').boundingBox();
    for (let i = 0; i < 2; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [
          {
            x: imageBox.x + imageBox.width / 2,
            y: imageBox.y + imageBox.height / 2,
            id: 1,
          },
        ],
      });
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
      });
      await page.waitForTimeout(70);
    }
    check(
      'native double tap zooms image',
      (await page.locator('.pf-gallery-image').getAttribute('data-zoomed')) ===
        'true',
    );
    await gallery
      .getByRole('button', { name: 'Уменьшить изображение', exact: true })
      .click();
    await gallery
      .getByRole('button', { name: 'Следующее вложение', exact: true })
      .click();
    await gallery
      .getByRole('button', { name: 'Следующее вложение', exact: true })
      .click();
    await gallery
      .getByText('Не удалось загрузить изображение', { exact: true })
      .waitFor();
    check('broken media has recoverable error', true);
    await page.evaluate(() =>
      fetch('/__fixture/media-control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fail: false }),
      }),
    );
    await gallery
      .getByRole('button', { name: 'Повторить', exact: true })
      .click();
    await page.waitForFunction(() => {
      const image = document.querySelector('.pf-gallery img');
      return (
        image?.complete && image.naturalWidth > 0 && image.style.opacity === '1'
      );
    });
    check('retry loads the image', true);
    for (const [name, width, height] of [
      ['mobile-320', 320, 720],
      ['mobile-375', 375, 812],
      ['mobile', 390, 844],
      ['mobile-414', 414, 896],
      ['tablet', 768, 1000],
      ['desktop', 1440, 1000],
    ]) {
      await cdp.send('Emulation.setTouchEmulationEnabled', {
        enabled: width < 768,
        maxTouchPoints: 5,
      });
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(350);
      // Crossing the existing shell breakpoint remounts route content; reopen its preview.
      if (!(await gallery.count())) {
        await page
          .getByRole('button', {
            name: 'Открыть Главная страница.png',
            exact: true,
          })
          .click();
        await gallery.waitFor();
        await page.waitForTimeout(800);
      }
      const box = await gallery.boundingBox();
      const targets = await gallery
        .locator('button:not([data-pf-sheet-handle]), a')
        .evaluateAll((nodes) =>
          nodes.map((e) => ({
            w: e.getBoundingClientRect().width,
            h: e.getBoundingClientRect().height,
          })),
        );
      check(
        name + ' gallery fits viewport',
        box.x >= -1 &&
          box.y >= -1 &&
          box.x + box.width <= width + 1 &&
          box.y + box.height <= height + 1,
        box,
      );
      check(
        name + ' gallery targets >=44px',
        targets.every((r) => r.w >= 43.99 && r.h >= 43.99),
        targets,
      );
      geometry.push({ name, box });
      await page.screenshot({ path: folder + name + '-gallery.png' });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await cdp.send('Emulation.setTouchEmulationEnabled', {
      enabled: true,
      maxTouchPoints: 5,
    });
    if (!(await gallery.count())) {
      await page
        .getByRole('button', {
          name: 'Открыть Главная страница.png',
          exact: true,
        })
        .click();
      await gallery.waitFor();
      await page.waitForTimeout(800);
    }
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.waitForTimeout(200);
    check(
      'reduced motion disables gallery fade',
      await gallery
        .locator('img')
        .evaluate(
          (e) => parseFloat(getComputedStyle(e).transitionDuration) <= 0.001,
        ),
    );
    await page.screenshot({ path: folder + 'dark-reduced-gallery.png' });
    await gallery
      .getByRole('button', { name: 'Закрыть просмотр', exact: true })
      .click();
    await page.keyboard.press('Escape');
    await page.emulateMedia({
      reducedMotion: 'no-preference',
      colorScheme: 'light',
    });
    await page.evaluate(() =>
      document.documentElement.classList.remove('dark'),
    );
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await page.setViewportSize({ width: 1440, height: 1000 });
    for (let i = 0; i < 3; i++) await page.keyboard.press('Escape');
    await main.evaluate((e) => (e.scrollTop = 0));
    const from = await page
      .locator('[data-pf-task-id="format-t1"]')
      .boundingBox();
    const to = await page
      .getByText('Перетащите сюда задачу, которой занимаетесь сейчас.', {
        exact: true,
      })
      .boundingBox();
    await page.mouse.move(from.x + 40, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + 55, from.y + from.height / 2, { steps: 4 });
    await page.waitForTimeout(150);
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
      steps: 16,
    });
    await page.waitForTimeout(150);
    await page.mouse.up();
    await page.getByRole('button', { name: 'Отменить', exact: true }).waitFor();
    check(
      'manual transfer reaches server fixture',
      (await state()).tasks.find((t) => t.id === 'format-t1').status ===
        'manual',
    );
    await page.screenshot({ path: folder + 'undo-transfer.png' });
    await page.getByRole('button', { name: 'Отменить', exact: true }).click();
    await page.getByText('Перемещение отменено', { exact: true }).waitFor();
    check(
      'undo restores previous task status',
      (await state()).tasks.find((t) => t.id === 'format-t1').status ===
        'backlog',
    );
    check('no uncaught browser exceptions', errors.length === 0, errors);
    return { checks, geometry, errors };
  } catch (error) {
    await page.screenshot({ path: folder + 'check-failure.png' });
    return { error: error.message, checks, geometry, errors };
  } finally {
    await page.unroute('**/src/presentation/pages/ProfilePage.tsx*');
    page.off('pageerror', onError);
    await cdp.detach();
  }
};
