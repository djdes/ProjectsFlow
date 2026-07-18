const { chromium } = require('playwright-core');
const { mkdirSync, writeFileSync } = require('node:fs');

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
          text: clean(element.innerText || element.textContent).slice(0, 500),
          ariaLabel: element.getAttribute('aria-label'),
          title: element.getAttribute('title'),
          placeholder: element.getAttribute('placeholder'),
          type: element.getAttribute('type'),
          value: element.tagName === 'INPUT' && ['text', 'url'].includes(element.getAttribute('type') || 'text') ? element.value.slice(0, 500) : null,
          state: element.getAttribute('data-state'),
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
        };
      })
      .filter((item) => item.rect.x >= 500 && item.rect.y >= 0 && item.rect.y < innerHeight);

    const frames = [...document.querySelectorAll('iframe')].map((frame) => {
      const rect = frame.getBoundingClientRect();
      const rawSource = frame.getAttribute('src');
      let source = rawSource;
      try {
        const parsed = new URL(rawSource, location.href);
        if (parsed.searchParams.has('access_token')) parsed.searchParams.set('access_token', '[redacted]');
        source = parsed.toString();
      } catch {
        source = rawSource;
      }
      return {
        title: frame.getAttribute('title'),
        src: source,
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      };
    });

    const scrollers = [...document.querySelectorAll('*')]
      .filter(visible)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          cls: typeof element.className === 'string' ? element.className.slice(0, 180) : null,
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
          clientW: element.clientWidth,
          clientH: element.clientHeight,
          scrollW: element.scrollWidth,
          scrollH: element.scrollHeight,
        };
      })
      .filter((item) => item.rect.x >= 500 && (item.scrollH > item.clientH + 4 || item.scrollW > item.clientW + 4));

    return {
      url: location.href,
      title: document.title,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      interactive,
      frames,
      scrollers,
    };
  });
  const screenshot = `reference/base44-preview/screenshots/desktop/${name}.png`;
  await page.screenshot({ path: screenshot, fullPage: false, animations: 'disabled' });
  return { ...data, screenshot };
}

async function main() {
  mkdirSync('reference/base44-preview/screenshots/desktop', { recursive: true });
  mkdirSync('reference/base44-preview/actual', { recursive: true });
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = browser.contexts()[0].pages()[0];
  await page.bringToFront();
  await page.setViewportSize({ width: 1440, height: 900 });

  const preview = page.getByRole('radio', { name: 'Preview', exact: true });
  if (!(await preview.count())) throw new Error('Preview control not found');
  await preview.click();
  await page.waitForTimeout(1800);

  const result = await capture(page, '01-default-1440x900');
  writeFileSync('reference/base44-preview/actual/default.json', `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
