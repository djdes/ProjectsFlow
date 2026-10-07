// Run in the existing Chrome after scripts/motion-browser-fixture.js. Synthetic data only.
async (page) => {
  const base = 'http://127.0.0.1:5184';
  const folder = 'C:/www/ProjectsFlow/reference/workspace-polish/actual/';
  const checks = [];
  const errors = [];
  const onError = (error) => errors.push(error.message);
  page.on('pageerror', onError);
  const check = (name, passed, detail) => {
    checks.push({ name, passed: Boolean(passed), detail });
    if (!passed) throw new Error(name + ': ' + JSON.stringify(detail));
  };
  const cdp = await page.context().newCDPSession(page);
  try {
    await page.evaluate(() =>
      fetch('/api/fixture/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delay: 0, taskDelay: 0, authDelay: 0 }),
      }),
    );
    await page.goto(base + '/projects/access-p0?view=default');
    await page.locator('[data-pf-task-id="format-t0"]').waitFor();
    for (let i = 0; i < 3; i++) await page.keyboard.press('Escape');
    const geometry = [];
    for (const [name, width, height] of [
      ['desktop', 1440, 1000],
      ['tablet', 768, 1000],
      ['mobile-320', 320, 720],
      ['mobile-375', 375, 812],
      ['mobile', 390, 844],
      ['mobile-414', 414, 896],
    ]) {
      await cdp.send('Emulation.setTouchEmulationEnabled', {
        enabled: width < 768,
        maxTouchPoints: 5,
      });
      await page.setViewportSize({ width, height });
      await page
        .getByRole('button', { name: 'Запустить проект', exact: true })
        .waitFor();
      await page.waitForTimeout(400);
      const measured = await page.evaluate(() => ({
        width: innerWidth,
        overflow: document.documentElement.scrollWidth > innerWidth,
        banner: document
          .querySelector('[data-pf-project-setup]')
          .getBoundingClientRect()
          .toJSON(),
        cards: [...document.querySelectorAll('[data-pf-task-id]')].map((e) => ({
          id: e.dataset.pfTaskId,
          rect: e.getBoundingClientRect().toJSON(),
        })),
        targets: [
          ...document.querySelectorAll(
            'nav[aria-label="Основная навигация"] button',
          ),
        ].map((e) => e.getBoundingClientRect().toJSON()),
      }));
      check(name + ' has no page overflow', !measured.overflow, measured.width);
      if (width < 768)
        check(
          name + ' navigation targets >=44px',
          measured.targets.length === 3 &&
            measured.targets.every((r) => r.height >= 44 && r.width >= 44),
        );
      geometry.push(measured);
      await page.screenshot({ path: folder + name + '-board.png' });
    }
    check(
      'authored bold title retained',
      (await page
        .locator('[data-pf-task-id="format-t0"] strong')
        .first()
        .innerText()) === 'Синхронизация данных',
    );
    check(
      'empty column explains its state',
      (await page
        .getByText('Здесь пока нет задач', { exact: true })
        .count()) === 1,
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByRole('button', { name: 'Запустить проект', exact: true })
      .click();
    const launch = page.getByRole('dialog', {
      name: 'Отправить проект на запуск?',
      exact: true,
    });
    await launch.waitFor();
    check(
      'launch keeps confirmation sheet',
      (await launch.getAttribute('data-pf-mobile-sheet')) === 'true',
    );
    await launch
      .getByRole('button', { name: 'Не сейчас', exact: true })
      .click();
    await launch.waitFor({ state: 'hidden' });

    await page.locator('[data-pf-task-id="format-t0"]').click();
    await page
      .locator('[data-pf-mobile-sheet="true"][data-state="open"]')
      .waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({ path: folder + 'mobile-task-sheet.png' });
    await page.keyboard.press('Escape');
    await page
      .locator('[data-pf-mobile-sheet="true"][data-state="open"]')
      .waitFor({ state: 'hidden' });
    check('task opens and closes as mobile sheet', true);

    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.screenshot({ path: folder + 'mobile-dark.png' });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page
      .getByRole('button', { name: 'Запустить проект', exact: true })
      .waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({ path: folder + 'desktop-dark.png' });
    await page.evaluate(() =>
      document.documentElement.classList.remove('dark'),
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByRole('navigation', { name: 'Основная навигация' })
      .waitFor();
    const nav = page.getByRole('navigation', { name: 'Основная навигация' });
    // HTMLElement.click is also how assistive technology activates a native button.
    await nav
      .getByRole('button', { name: 'Входящие', exact: true })
      .evaluate((e) => e.click());
    await page.waitForURL(base + '/');
    check('native click navigates', true);
    await nav.getByRole('button', { name: 'Профиль', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.waitForURL(base + '/profile');
    check('Enter navigates', true);
    await nav.getByRole('button', { name: 'Входящие', exact: true }).focus();
    await page.keyboard.press('Space');
    await page.waitForURL(base + '/');
    check('Space navigates', true);

    const inbox = await nav
      .getByRole('button', { name: 'Входящие', exact: true })
      .boundingBox();
    const profile = await nav
      .getByRole('button', { name: 'Профиль', exact: true })
      .boundingBox();
    const y = inbox.y + inbox.height / 2;
    await page.mouse.move(inbox.x + inbox.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(profile.x + profile.width / 2, y, { steps: 8 });
    await page.mouse.up();
    await page.waitForURL(base + '/profile');
    check('horizontal drag navigates once on release', true);
    await page.mouse.move(profile.x + profile.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(inbox.x + inbox.width / 2, y - 100, { steps: 8 });
    await page.mouse.up();
    check(
      'release outside dock cancels navigation',
      page.url() === base + '/profile',
    );

    await cdp.send('Emulation.setTouchEmulationEnabled', {
      enabled: true,
      maxTouchPoints: 5,
    });
    const startX = inbox.x + inbox.width / 2;
    const endX = profile.x + profile.width / 2;
    const touch = (type, x = startX) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints:
          type === 'touchEnd' || type === 'touchCancel'
            ? []
            : [{ x, y, id: 1 }],
      });
    await touch('touchStart');
    await touch('touchEnd');
    await page.waitForURL(base + '/');
    check('native touch tap navigates', true);
    for (const end of ['touchCancel', 'touchEnd']) {
      await touch('touchStart');
      for (let i = 1; i <= 8; i++) {
        await touch('touchMove', startX + ((endX - startX) * i) / 8);
        await page.waitForTimeout(25);
      }
      await touch(end);
      if (end === 'touchCancel')
        check(
          'native touch cancellation keeps route',
          page.url() === base + '/',
        );
      else {
        await page.waitForURL(base + '/profile');
        check('native swipe survives implicit capture transfer', true);
      }
    }

    await page.emulateMedia({ reducedMotion: 'reduce' });
    const duration = await page
      .locator('.pf-nav-glass')
      .evaluate((e) => parseFloat(getComputedStyle(e).transitionDuration));
    check('reduced motion disables dock transition', duration < 0.01, duration);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForFunction(() => {
      const nav = document.querySelector(
        'nav[aria-label="Основная навигация"]',
      );
      const active = nav
        ?.querySelector('[aria-current="page"]')
        ?.getBoundingClientRect();
      const indicator = nav
        ?.querySelector('.pf-nav-glass')
        ?.getBoundingClientRect();
      return active && indicator && Math.abs(active.x - indicator.x) < 1;
    });
    check('indicator settles on the active destination', true);
    await page.screenshot({ path: folder + 'mobile-active-navigation.png' });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(base + '/projects/access-p0?view=default');
    await page.locator('[data-pf-task-id="format-t2"]').waitFor();
    await page
      .getByRole('button', { name: 'Запустить проект', exact: true })
      .waitFor();
    const drag = async (id, target) => {
      const from = await page
        .locator(`[data-pf-task-id="${id}"]`)
        .boundingBox();
      const to = await target.boundingBox();
      await page.mouse.move(from.x + 40, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(from.x + 55, from.y + from.height / 2, {
        steps: 4,
      });
      await page.waitForTimeout(150);
      await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
        steps: 16,
      });
      await page.waitForTimeout(150);
      await page.mouse.up();
      await page.waitForTimeout(450);
      return page.evaluate(() =>
        fetch('/api/fixture/state').then((r) => r.json()),
      );
    };
    const done = await drag(
      'format-t2',
      page.getByText('Здесь пока нет задач', { exact: true }),
    );
    check(
      'drop into empty done column reaches done',
      done.tasks.find((t) => t.id === 'format-t2').status === 'done',
    );
    const manual = await drag(
      'format-t1',
      page.getByText('Перетащите сюда задачу, которой занимаетесь сейчас.', {
        exact: true,
      }),
    );
    check(
      'manual shelf still accepts a drop inside its bounds',
      manual.tasks.find((t) => t.id === 'format-t1').status === 'manual',
    );
    check('no uncaught browser exceptions', errors.length === 0, errors);
    const fixture = await page.evaluate(() =>
      fetch('/api/fixture/state').then((r) => r.json()),
    );
    check(
      'review did not launch a project',
      !fixture.writes.some((write) =>
        /launch|ensure-app/.test(write.path ?? write.url ?? ''),
      ),
    );
    return { checks, geometry, errors };
  } finally {
    page.off('pageerror', onError);
    await cdp.detach();
  }
};
