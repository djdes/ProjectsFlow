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
    const items = [...document.querySelectorAll('button,a,input,textarea,select,[role],[data-state]')]
      .filter(visible)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          role: element.getAttribute('role'),
          text: clean(element.innerText || element.textContent).slice(0, 800),
          ariaLabel: element.getAttribute('aria-label'),
          placeholder: element.getAttribute('placeholder'),
          type: element.getAttribute('type'),
          state: element.getAttribute('data-state'),
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
        };
      })
      .filter((item) => item.rect.x >= 500 && item.rect.y >= 0 && item.rect.y < innerHeight);
    const visibleText = [...document.querySelectorAll('body *')]
      .filter(visible)
      .filter((element) => element.children.length === 0)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return rect.x >= 735 && rect.y >= 45 && rect.y < innerHeight ? clean(element.textContent) : '';
      })
      .filter(Boolean);
    return {
      url: location.href,
      text: [...new Set(visibleText)].join(' | ').slice(0, 30000),
      items,
    };
  });
  const screenshot = `reference/base44-dashboard/screenshots/desktop/${name}.png`;
  await page.screenshot({ path: screenshot, fullPage: false, animations: 'disabled' });
  return { ...data, screenshot };
}

async function closeOverlay(page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  const cancel = page.getByRole('button', { name: /^(Cancel|Close)$/i });
  if (await cancel.count()) {
    await cancel.last().click();
    await page.waitForTimeout(500);
  }
}

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = browser.contexts()[0].pages()[0];
  await page.bringToFront();
  await page.setViewportSize({ width: 1440, height: 900 });

  const data = page.getByRole('button', { name: 'Data', exact: true });
  if (await data.count()) {
    await data.last().click();
    await page.waitForTimeout(700);
  }
  const product = page.getByRole('button', { name: 'Product', exact: true });
  if (await product.count()) {
    await product.last().click();
    await page.waitForTimeout(800);
  }

  const results = [];

  const firstProduct = page.getByText('Борщ домашний 500мл', { exact: true });
  if (await firstProduct.count()) {
    await firstProduct.last().click();
    await page.waitForTimeout(700);
    results.push({ state: 'row-details', status: 'observed', ...(await capture(page, '21-data-product-row-details')) });
    await closeOverlay(page);
  } else {
    results.push({ state: 'row-details', status: 'not found' });
  }

  for (const [label, filename] of [
    ['Filters', '22-data-product-filters'],
    ['Permissions', '23-data-product-permissions'],
    ['Add Item', '24-data-product-add-item'],
  ]) {
    const control = page.getByRole('button', { name: label, exact: true });
    if (!(await control.count())) {
      results.push({ state: label, status: 'not found' });
      continue;
    }
    await control.last().click();
    await page.waitForTimeout(600);
    results.push({ state: label, status: 'observed', ...(await capture(page, filename)) });
    await closeOverlay(page);
  }

  writeFileSync('reference/base44-dashboard/actual/data-states.json', `${JSON.stringify(results, null, 2)}\n`, 'utf8');
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
