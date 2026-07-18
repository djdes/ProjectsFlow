/* Clean-room capture: attaches only to the already-open Base44 tab over CDP. */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const shots = path.join(root, 'screenshots');
fs.mkdirSync(shots, { recursive: true });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const box = async locator => {
  try { return await locator.boundingBox(); } catch { return null; }
};

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const pages = browser.contexts().flatMap(context => context.pages());
  const page = pages.find(candidate => candidate.url().includes('app.base44.com/apps/'));
  if (!page) throw new Error('Prepared Base44 tab was not found');

  const initialViewport = page.viewportSize() || { width: 950, height: 634 };
  const previewRadio = () => page.getByRole('radio', { name: 'Preview', exact: true });
  const dashboardRadio = () => page.getByRole('radio', { name: 'Dashboard', exact: true });
  const button = name => page.getByRole('button', { name, exact: true });

  const isVisible = async locator => locator.isVisible().catch(() => false);
  const clickVisible = async locator => {
    if (await isVisible(locator)) { await locator.click(); return true; }
    return false;
  };
  const ensurePreview = async () => {
    if (await isVisible(previewRadio())) {
      const checked = await previewRadio().getAttribute('aria-checked');
      if (checked !== 'true') await previewRadio().click();
    }
    await sleep(900);
    const canvas = button('Canvas');
    if (await isVisible(canvas) && await canvas.getAttribute('aria-pressed') === 'true') {
      await canvas.click();
      await sleep(900);
    }
  };
  const ensureChat = async open => {
    const hide = button('Hide chat panel');
    const show = button('Show chat panel');
    if (open && await isVisible(show)) await show.click();
    if (!open && await isVisible(hide)) await hide.click();
    await sleep(1500);
  };
  const ensureDesktopDevice = async () => {
    for (let i = 0; i < 4; i += 1) {
      if (await isVisible(button('Show tablet preview'))) return;
      if (await clickVisible(button('Show mobile preview'))) { await sleep(650); continue; }
      if (await clickVisible(button('Show desktop preview'))) { await sleep(650); continue; }
      return;
    }
  };
  const maskLocators = () => [
    page.locator('div.flex-grow.overflow-y-auto').first(),
    page.locator('img[alt="Purity Protocol"]'),
    page.getByRole('link', { name: 'Account menu' }),
    page.locator('button:has(.group\\/avatars)'),
    page.locator('button img[alt="BD"]')
  ];
  const snap = async name => page.screenshot({
    path: path.join(shots, name),
    fullPage: false,
    animations: 'disabled',
    mask: maskLocators(),
    maskColor: '#d7d9dd'
  });
  const collect = async label => {
    const chatToggle = page.getByRole('button', { name: /chat panel$/ }).first();
    let wrapper = null;
    if (await isVisible(chatToggle)) {
      wrapper = await chatToggle.evaluate(el => {
        let current = el;
        while (current && !String(current.className).includes('transition-[flex-grow]')) current = current.parentElement;
        if (!current) return null;
        const rect = current.getBoundingClientRect();
        const style = getComputedStyle(current);
        return {
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          flexGrow: style.flexGrow,
          transition: style.transition
        };
      }).catch(() => null);
    }
    const frames = page.locator('iframe[title="App Preview"]');
    const frameBoxes = [];
    for (let i = 0; i < await frames.count(); i += 1) frameBoxes.push(await box(frames.nth(i)));
    const chatScroller = page.locator('div.flex-grow.overflow-y-auto').first();
    const scroller = await chatScroller.evaluate(el => ({
      rect: (() => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })(),
      clientWidth: el.clientWidth,
      clientHeight: el.clientHeight,
      scrollWidth: el.scrollWidth,
      scrollHeight: el.scrollHeight,
      overflowX: getComputedStyle(el).overflowX,
      overflowY: getComputedStyle(el).overflowY
    })).catch(() => null);
    return {
      label,
      viewport: page.viewportSize(),
      path: new URL(page.url()).pathname,
      wrapper,
      frameBoxes,
      chatScroller: scroller,
      visibleButtons: await page.getByRole('button').evaluateAll(elements => elements.filter(el => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      }).map(el => ({
        name: el.getAttribute('aria-label') || el.textContent.trim().replace(/\s+/g, ' ').slice(0, 80),
        pressed: el.getAttribute('aria-pressed'),
        x: Math.round(el.getBoundingClientRect().x * 100) / 100,
        y: Math.round(el.getBoundingClientRect().y * 100) / 100,
        width: Math.round(el.getBoundingClientRect().width * 100) / 100,
        height: Math.round(el.getBoundingClientRect().height * 100) / 100
      })))
    };
  };

  const states = [];
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await ensurePreview();
    await ensureDesktopDevice();
    const edit = button('Edit mode');
    if (await isVisible(edit) && await edit.getAttribute('aria-pressed') === 'true') await edit.click();
    await ensureChat(true);
    states.push(await collect('desktop-preview-chat-open'));
    await snap('desktop/01-preview-chat-open-1440x900.png');

    await ensureChat(false);
    states.push(await collect('desktop-preview-chat-hidden'));
    await snap('desktop/02-preview-chat-hidden-1440x900.png');
    await ensureChat(true);

    if (await clickVisible(button('Show tablet preview'))) {
      await sleep(800);
      states.push(await collect('desktop-tablet-device'));
      await snap('desktop/03-tablet-device-1440x900.png');
    }
    await ensureDesktopDevice();

    const route = page.locator('input[placeholder="/page"]');
    if (await isVisible(route)) {
      await route.click(); await sleep(300);
      await snap('desktop/04-route-menu-1440x900.png');
      await page.keyboard.press('Escape');
    }

    if (await clickVisible(edit)) {
      await sleep(400);
      states.push(await collect('desktop-edit-mode'));
      await snap('desktop/05-edit-mode-1440x900.png');
      await edit.click(); await sleep(400);
    }

    if (await clickVisible(button('Canvas'))) {
      await sleep(900);
      states.push(await collect('desktop-canvas'));
      await snap('desktop/06-canvas-1440x900.png');
      await button('Canvas').click(); await sleep(900);
    }

    if (await clickVisible(button('More actions'))) {
      await sleep(250);
      await snap('desktop/07-more-actions-1440x900.png');
      await page.keyboard.press('Escape');
    }

    if (await isVisible(dashboardRadio())) {
      await dashboardRadio().click(); await sleep(1200);
      states.push(await collect('desktop-dashboard'));
      await snap('desktop/08-dashboard-1440x900.png');
      await previewRadio().click(); await sleep(1000);
    }

    await page.setViewportSize({ width: 1024, height: 768 });
    await ensurePreview(); await ensureDesktopDevice(); await ensureChat(true);
    states.push(await collect('tablet-browser-chat-open'));
    await snap('tablet/01-preview-chat-open-1024x768.png');
    await ensureChat(false);
    states.push(await collect('tablet-browser-chat-hidden'));
    await snap('tablet/02-preview-chat-hidden-1024x768.png');

    await page.setViewportSize({ width: 390, height: 844 });
    await ensurePreview(); await ensureChat(true);
    states.push(await collect('mobile-browser-chat-open'));
    await snap('mobile/01-preview-chat-open-390x844.png');
    await ensureChat(false);
    states.push(await collect('mobile-browser-chat-hidden'));
    await snap('mobile/02-preview-chat-hidden-390x844.png');

    fs.writeFileSync(path.join(__dirname, 'desktop-states.json'), JSON.stringify(states, null, 2));
  } finally {
    await page.setViewportSize(initialViewport);
    await ensurePreview().catch(() => {});
    await ensureDesktopDevice().catch(() => {});
    await ensureChat(true).catch(() => {});
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
