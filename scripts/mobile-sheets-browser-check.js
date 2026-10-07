// Run through the existing Chrome/CDP connection after motion-browser-fixture.js.
// Uses synthetic intercepted API data only; never sends real invitations or support messages.
async (page) => {
  const results = [];
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const base = 'C:/www/ProjectsFlow/reference/mobile-sheets/actual/';
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', {
    enabled: true,
    maxTouchPoints: 5,
  });
  const check = (condition, name) => {
    if (!condition) throw new Error(name);
    results.push(name);
  };
  try {
    const opened = page.locator(
      '[data-pf-mobile-sheet="true"][data-state="open"]',
    );
    const swipe = async (x, y, dx, dy, cancel = false) => {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x, y }],
      });
      for (let i = 1; i <= 10; i++) {
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: x + (dx * i) / 10, y: y + (dy * i) / 10 }],
        });
        await page.waitForTimeout(20);
      }
      await cdp.send('Input.dispatchTouchEvent', {
        type: cancel ? 'touchCancel' : 'touchEnd',
        touchPoints: [],
      });
      await page.waitForTimeout(420);
    };
    const pull = async (distance, cancel = false, horizontal = 0) => {
      const handle = opened.last().locator('[data-pf-sheet-handle]').first();
      await handle.waitFor({ state: 'visible' });
      const box = await handle.boundingBox();
      await swipe(
        box.x + box.width / 2,
        box.y + box.height / 2,
        horizontal,
        distance,
        cancel,
      );
    };
    const share = async () => {
      await page
        .getByRole('button', { name: 'Поделиться', exact: true })
        .click();
      await opened.waitFor();
      await page.waitForTimeout(400);
    };
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('http://127.0.0.1:5184/projects/access-p0?view=default');
    await page
      .getByRole('button', {
        name: 'Поделиться',
        exact: true,
        includeHidden: true,
      })
      .first()
      .waitFor({ state: 'attached', timeout: 20000 });
    // The app restores the last open task on reload. Start each run from the project itself.
    for (let i = 0; i < 3 && (await opened.count()); i++) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(350);
    }
    await page
      .getByRole('button', { name: 'Поделиться', exact: true })
      .waitFor({ timeout: 20000 });
    await share();
    await pull(18);
    check((await opened.count()) === 1, 'short pull settles without closing');
    await pull(3, false, 90);
    check((await opened.count()) === 1, 'horizontal gesture does not dismiss');
    await pull(140, true);
    check((await opened.count()) === 1, 'touch cancellation resets the sheet');
    const body = opened.locator('.pf-mobile-sheet-scroll');
    await body.evaluate((el) => {
      el.scrollTop = 350;
    });
    await page.waitForTimeout(100);
    const b = await body.boundingBox();
    await swipe(b.x + 2, b.y + 90, 0, 130);
    check(
      (await opened.count()) === 1,
      'downward scroll inside long content does not close',
    );
    const handleBox = await opened
      .locator('[data-pf-sheet-handle]')
      .boundingBox();
    check(
      handleBox.y >= 12 && handleBox.y < 100,
      'handle remains visible while body scrolls',
    );
    await pull(150);
    check(
      (await opened.count()) === 0,
      'pulling the handle closes a scrolled sheet',
    );
    check(
      await page
        .getByRole('button', { name: 'Поделиться', exact: true })
        .evaluate((el) => el === document.activeElement),
      'share focus returns to its trigger',
    );
    for (const width of [320, 390, 414, 700]) {
      await page.setViewportSize({ width, height: 844 });
      await share();
      const rect = await opened.evaluate((el) =>
        el.getBoundingClientRect().toJSON(),
      );
      check(
        Math.abs(rect.width - width) < 1 &&
          rect.x === 0 &&
          Math.abs(rect.bottom - 844) < 1,
        `sheet fits ${width}px viewport`,
      );
      await page.screenshot({ path: `${base}share-${width}.png` });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(240);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByText('Синхронизация данных и НДС', { exact: true })
      .first()
      .click();
    await opened.waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${base}task-390.png` });
    await opened
      .getByRole('button', { name: /^Срок:|^Срок выполнения$/ })
      .click();
    await page.getByRole('menu').waitFor();
    await page.waitForTimeout(350);
    check((await opened.count()) === 2, 'deadline opens above the task');
    await page.screenshot({ path: `${base}deadline-nested.png` });
    await pull(150);
    check((await opened.count()) === 1, 'swipe dismisses only the nested menu');
    await opened
      .getByRole('button', { name: /^Срок:|^Срок выполнения$/ })
      .click();
    await page.getByRole('menuitem', { name: 'Завтра', exact: true }).click();
    await page.waitForTimeout(350);
    check(
      (await opened.count()) === 1,
      'selecting a deadline keeps the task open',
    );
    await pull(150);
    check(
      (await opened.count()) === 0,
      'task dismisses through the common close path',
    );
    await page
      .getByRole('button', { name: 'Настройки отображения', exact: true })
      .click();
    await opened.waitFor();
    await page.waitForTimeout(350);
    check((await opened.count()) === 1, 'board settings use a sheet');
    await page.screenshot({ path: `${base}board-settings.png` });
    await pull(150);
    await page
      .getByRole('button', { name: 'Открыть меню', exact: true })
      .click();
    check(
      (await opened.count()) === 0,
      'main navigation keeps its side drawer',
    );
    await page.getByRole('button', { name: 'Задача', exact: true }).click();
    await page.getByRole('dialog', { name: 'Новая задача' }).waitFor();
    await page.waitForTimeout(450);
    await page.screenshot({ path: `${base}create-task.png` });
    check((await opened.count()) === 1, 'task creation uses a bottom sheet');
    await opened
      .locator('[contenteditable="true"]')
      .first()
      .fill('Мобильный черновик — проверка свайпа');
    await pull(150);
    check((await opened.count()) === 0, 'swipe closes the task form');
    await page.getByRole('button', { name: 'Задача', exact: true }).click();
    await page
      .getByRole('button', { name: 'Восстановить прошлую задачу', exact: true })
      .click();
    check(
      (
        await opened.locator('[contenteditable="true"]').first().innerText()
      ).includes('Мобильный черновик'),
      'draft survives swipe and can be restored',
    );
    await page.setViewportSize({ width: 390, height: 440 });
    await page.waitForTimeout(250);
    const keyboardRect = await opened.evaluate((el) =>
      el.getBoundingClientRect().toJSON(),
    );
    check(
      keyboardRect.bottom <= 441 && keyboardRect.top >= 0,
      'short viewport keeps the form within reach',
    );
    await page.screenshot({ path: `${base}create-task-keyboard-height.png` });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent('pf:open-help', { detail: { tab: 'support' } }),
      ),
    );
    await page.getByRole('dialog').waitFor();
    await page.waitForTimeout(350);
    check((await opened.count()) === 1, 'support uses the same sheet');
    await page.screenshot({ path: `${base}support.png` });
    await pull(150);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await share();
    check(
      await opened.evaluate(
        (el) => parseFloat(getComputedStyle(el).animationDuration) < 0.01,
      ),
      'OS reduced-motion preference is respected',
    );
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await share();
    await page.screenshot({ path: `${base}share-dark.png` });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    await page.evaluate(() =>
      document.documentElement.classList.remove('dark'),
    );
    for (const width of [768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page
        .getByRole('button', { name: 'Поделиться', exact: true })
        .click();
      await page.getByRole('dialog').waitFor();
      await page.waitForTimeout(350);
      check(
        (await opened.count()) === 0,
        `anchored popover retained at ${width}px`,
      );
      await page.screenshot({ path: `${base}share-${width}.png` });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
    }
    check(errors.length === 0, `no page errors: ${errors.join('; ')}`);
    await cdp.detach();
    return results;
  } catch (error) {
    await cdp.detach();
    return {
      results,
      error: error.message,
      pageErrors: errors,
      url: page.url(),
    };
  }
};
