const { chromium } = require('playwright-core');
const { mkdirSync, writeFileSync } = require('node:fs');

const sections = [
  'Overview',
  'Users',
  'Data',
  'Analytics',
  'Marketing',
  'Domains',
  'Integrations',
  'Security',
  'Code',
  'Agents',
  'Workflows',
  'Logs',
  'API',
  'Settings',
];

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

async function capture(page, name) {
  const data = await page.evaluate(() => {
    const clean = (value) => (value || '').replace(/\s+/g, ' ').trim();
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const nodes = [...document.querySelectorAll('button,a,input,textarea,select,[role="button"],[role="tab"],[role="switch"],[role="menuitem"],[role="dialog"]')]
      .filter(visible)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          role: element.getAttribute('role'),
          text: clean(element.innerText || element.textContent).slice(0, 300),
          ariaLabel: element.getAttribute('aria-label'),
          placeholder: element.getAttribute('placeholder'),
          type: element.getAttribute('type'),
          href: element.tagName === 'A' ? element.getAttribute('href') : null,
          checked: element.getAttribute('role') === 'switch' ? element.getAttribute('aria-checked') : null,
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            w: Math.round(rect.width),
            h: Math.round(rect.height),
          },
        };
      })
      .filter((item) => item.rect.x >= 500 && item.rect.y >= 0 && item.rect.y < innerHeight);

    const textEntries = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const text = clean(node.nodeValue);
      if (!text) continue;
      const parent = node.parentElement;
      if (!parent || !visible(parent)) continue;
      const rect = parent.getBoundingClientRect();
      if (rect.x < 735 || rect.y < 45 || rect.y >= innerHeight) continue;
      textEntries.push(text);
    }

    const scrollers = [...document.querySelectorAll('*')]
      .filter(visible)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          id: element.id || null,
          cls: typeof element.className === 'string' ? element.className.slice(0, 180) : null,
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
          clientW: element.clientWidth,
          clientH: element.clientHeight,
          scrollW: element.scrollWidth,
          scrollH: element.scrollHeight,
        };
      })
      .filter((item) => item.x >= 500 && (item.scrollH > item.clientH + 4 || item.scrollW > item.clientW + 4));

    return {
      url: location.href,
      title: document.title,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      text: [...new Set(textEntries)].join(' | ').slice(0, 20000),
      interactive: nodes,
      scrollers,
    };
  });

  const filename = `reference/base44-dashboard/screenshots/desktop/${name}.png`;
  await page.screenshot({ path: filename, fullPage: false, animations: 'disabled' });
  return { ...data, screenshot: filename };
}

async function main() {
  mkdirSync('reference/base44-dashboard/screenshots/desktop', { recursive: true });
  mkdirSync('reference/base44-dashboard/actual', { recursive: true });
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = browser.contexts()[0].pages()[0];
  await page.bringToFront();
  await page.setViewportSize({ width: 1440, height: 900 });

  const deny = page.getByRole('button', { name: 'Deny', exact: true });
  if (await deny.count()) {
    await deny.click();
    await page.waitForTimeout(300);
  }

  const results = [];
  let index = 2;
  for (const section of sections) {
    const control = page.getByRole('button', { name: section, exact: true }).last();
    if (!(await control.count())) {
      results.push({ section, status: 'not found' });
      continue;
    }
    try {
      await control.click();
      await page.waitForTimeout(900);
      results.push({
        section,
        status: 'observed',
        ...(await capture(page, `${String(index).padStart(2, '0')}-${slug(section)}`)),
      });
      index += 1;
    } catch (error) {
      results.push({ section, status: 'failed', error: String(error) });
    }
  }

  writeFileSync(
    'reference/base44-dashboard/actual/sections.json',
    `${JSON.stringify(results, null, 2)}\n`,
    'utf8',
  );
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
