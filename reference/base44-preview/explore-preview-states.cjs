const { chromium } = require('playwright-core');
const { writeFileSync } = require('node:fs');

async function capture(page, name) {
  const data = await page.evaluate(() => {
    const clean = (value) => (value || '').replace(/\s+/g, ' ').trim();
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const interactive = [...document.querySelectorAll('button,a,input,textarea,select,[role],[data-state]')]
      .filter(visible)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          role: element.getAttribute('role'),
          text: clean(element.innerText || element.textContent).slice(0, 600),
          ariaLabel: element.getAttribute('aria-label'),
          title: element.getAttribute('title'),
          placeholder: element.getAttribute('placeholder'),
          type: element.getAttribute('type'),
          state: element.getAttribute('data-state'),
          checked: element.getAttribute('aria-checked'),
          pressed: element.getAttribute('aria-pressed'),
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
        };
      })
      .filter((item) => item.rect.x >= 500 && item.rect.y >= 0 && item.rect.y < innerHeight);
    const frames = [...document.querySelectorAll('iframe')].map((frame) => {
      const rect = frame.getBoundingClientRect();
      return { title: frame.getAttribute('title'), rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) } };
    });
    return { url: location.href, interactive, frames };
  });
  const screenshot = `reference/base44-preview/screenshots/desktop/${name}.png`;
  await page.screenshot({ path: screenshot, fullPage: false, animations: 'disabled' });
  return { ...data, screenshot };
}

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = browser.contexts()[0].pages()[0];
  await page.bringToFront();
  await page.setViewportSize({ width: 1440, height: 900 });
  const results = [];

  const preview = page.getByRole('radio', { name: 'Preview', exact: true });
  if (await preview.count()) {
    await preview.click();
    await page.waitForTimeout(900);
  }

  const routeInput = page.locator('input[placeholder="/page"]');
  if (await routeInput.count()) {
    await routeInput.click();
    await page.waitForTimeout(400);
    results.push({ state: 'page-selector', status: 'observed', ...(await capture(page, '02-page-selector')) });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  } else {
    results.push({ state: 'page-selector', status: 'not found' });
  }

  for (const [label, state, filename] of [
    ['Show tablet preview', 'tablet', '03-tablet'],
    ['Show mobile preview', 'mobile', '04-mobile'],
    ['Show desktop preview', 'desktop-restored', '05-desktop-restored'],
  ]) {
    const control = page.getByRole('button', { name: label, exact: true });
    if (!(await control.count())) {
      results.push({ state, status: 'not found' });
      continue;
    }
    await control.click();
    await page.waitForTimeout(600);
    results.push({ state, status: 'observed', ...(await capture(page, filename)) });
  }

  const canvas = page.getByRole('button', { name: 'Canvas', exact: true });
  if (await canvas.count()) {
    await canvas.click();
    await page.waitForTimeout(500);
    results.push({ state: 'canvas', status: 'observed', ...(await capture(page, '06-canvas')) });
    await page.keyboard.press('Escape');
  } else {
    results.push({ state: 'canvas', status: 'not found' });
  }

  const edit = page.getByRole('button', { name: 'Edit mode', exact: true });
  if (await edit.count()) {
    await edit.click();
    await page.waitForTimeout(600);
    results.push({ state: 'edit-mode', status: 'observed', ...(await capture(page, '07-edit-mode')) });
    await edit.click();
    await page.waitForTimeout(300);
  } else {
    results.push({ state: 'edit-mode', status: 'not found' });
  }

  const more = page.getByRole('button', { name: 'More actions', exact: true });
  if (await more.count()) {
    await more.last().click();
    await page.waitForTimeout(400);
    results.push({ state: 'more-actions', status: 'observed', ...(await capture(page, '08-more-actions')) });
    await page.keyboard.press('Escape');
  } else {
    results.push({ state: 'more-actions', status: 'not found' });
  }

  const publish = page.getByRole('button', { name: 'Publish App', exact: true });
  if (await publish.count()) {
    await publish.click();
    await page.waitForTimeout(600);
    results.push({ state: 'publish-dialog', status: 'observed', ...(await capture(page, '09-publish-dialog')) });
    await page.keyboard.press('Escape');
  } else {
    results.push({ state: 'publish-dialog', status: 'not found' });
  }

  writeFileSync('reference/base44-preview/actual/states.json', `${JSON.stringify(results, null, 2)}\n`, 'utf8');
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
