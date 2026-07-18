const { chromium } = require('playwright-core');
const { mkdirSync, writeFileSync } = require('node:fs');

async function snapshot(page, name) {
  const data = await page.evaluate(() => {
    const clean = (value) => (value || '').replace(/\s+/g, ' ').trim();
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const elements = [...document.querySelectorAll('button,a,input,textarea,select,[role],[data-state]')]
      .filter(visible)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          role: element.getAttribute('role'),
          text: clean(element.innerText || element.textContent).slice(0, 500),
          ariaLabel: element.getAttribute('aria-label'),
          placeholder: element.getAttribute('placeholder'),
          type: element.getAttribute('type'),
          state: element.getAttribute('data-state'),
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
        };
      })
      .filter((item) => item.rect.x >= 500 && item.rect.y >= 0 && item.rect.y < innerHeight);
    const rightText = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const text = clean(node.nodeValue);
      if (!text || !node.parentElement || !visible(node.parentElement)) continue;
      const rect = node.parentElement.getBoundingClientRect();
      if (rect.x >= 735 && rect.y >= 45 && rect.y < innerHeight) rightText.push(text);
    }
    return {
      url: location.href,
      text: [...new Set(rightText)].join(' | ').slice(0, 30000),
      elements,
    };
  });
  const screenshot = `reference/base44-dashboard/screenshots/desktop/${name}.png`;
  await page.screenshot({ path: screenshot, fullPage: false, animations: 'disabled' });
  return { ...data, screenshot };
}

async function clickExact(page, name, options = {}) {
  const control = page.getByRole('button', { name, exact: true });
  if (!(await control.count())) return false;
  const item = options.first ? control.first() : control.last();
  await item.click();
  await page.waitForTimeout(900);
  return true;
}

async function main() {
  mkdirSync('reference/base44-dashboard/actual', { recursive: true });
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = browser.contexts()[0].pages()[0];
  await page.bringToFront();
  await page.setViewportSize({ width: 1440, height: 900 });

  const back = page.getByText('Back to Dashboard', { exact: true });
  if (await back.count()) {
    await back.click();
    await page.waitForTimeout(900);
  }
  await clickExact(page, 'Data');

  const results = [];
  for (const entity of ['Category', 'Order', 'Product']) {
    const candidates = page.getByRole('button', { name: entity, exact: true });
    if (!(await candidates.count())) {
      results.push({ entity, status: 'not found' });
      continue;
    }
    await candidates.last().click();
    await page.waitForTimeout(1000);
    results.push({ entity, status: 'observed', ...(await snapshot(page, `20-data-${entity.toLowerCase()}`)) });

    const dataButton = page.getByRole('button', { name: 'Data', exact: true });
    if (await dataButton.count()) {
      await dataButton.last().click();
      await page.waitForTimeout(600);
    }
  }

  writeFileSync('reference/base44-dashboard/actual/data-entities.json', `${JSON.stringify(results, null, 2)}\n`, 'utf8');
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
