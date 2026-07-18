const { chromium } = require('playwright-core');
const { writeFileSync } = require('node:fs');

async function main() {
  const browser = await chromium.connectOverCDP(process.env.CDP_URL || 'http://127.0.0.1:9222');
  const contexts = browser.contexts();
  if (!contexts.length) throw new Error('No browser contexts');

  const pages = contexts.flatMap((context) => context.pages());
  const page = pages.find((candidate) => candidate.url().includes('app.base44.com'));
  if (!page) throw new Error('Base44 reference tab not found');
  await page.bringToFront();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(1500);

  const summary = await page.evaluate(() => {
    const clean = (value) => (value || '').replace(/\s+/g, ' ').trim();
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const elementInfo = (element) => {
      const rect = element.getBoundingClientRect();
      return {
        tag: element.tagName.toLowerCase(),
        role: element.getAttribute('role'),
        text: clean(element.innerText || element.textContent).slice(0, 240),
        ariaLabel: element.getAttribute('aria-label'),
        title: element.getAttribute('title'),
        placeholder: element.getAttribute('placeholder'),
        type: element.getAttribute('type'),
        href: element.tagName === 'A' ? element.getAttribute('href') : null,
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        },
      };
    };
    const selector = [
      'button',
      'a',
      'input',
      'textarea',
      'select',
      '[role="button"]',
      '[role="tab"]',
      '[role="menuitem"]',
      '[role="dialog"]',
      '[role="switch"]',
    ].join(',');
    const interactive = [...document.querySelectorAll(selector)].filter(visible).map(elementInfo);
    const scrollers = [...document.querySelectorAll('*')]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          id: element.id || null,
          cls: typeof element.className === 'string' ? element.className.slice(0, 160) : null,
          clientW: element.clientWidth,
          clientH: element.clientHeight,
          scrollW: element.scrollWidth,
          scrollH: element.scrollHeight,
          x: Math.round(rect.x),
          y: Math.round(rect.y),
        };
      })
      .filter((item) => item.scrollH > item.clientH + 4 || item.scrollW > item.clientW + 4)
      .slice(0, 80);

    return {
      title: document.title,
      url: location.href,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      document: {
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        scrollX,
        scrollY,
      },
      bodyText: clean(document.body.innerText).slice(0, 16000),
      interactive,
      scrollers,
    };
  });

  await page.screenshot({
    path: 'reference/base44-dashboard/screenshots/desktop/01-default-1440x900.png',
    fullPage: false,
    animations: 'disabled',
  });
  writeFileSync(
    'reference/base44-dashboard/actual/current.json',
    `${JSON.stringify(summary, null, 2)}\n`,
    'utf8',
  );
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
