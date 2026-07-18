const { chromium } = require('playwright-core');
const { writeFileSync } = require('node:fs');

async function capture(page, name) {
  const data = await page.evaluate(() => {
    const clean = (value) => (value || '').replace(/\s+/g, ' ').trim();
    const redact = (value) => clean(value)
      .replace(/("?api_key"?\s*[:=]\s*["'])[^"']+(["'])/gi, '$1[redacted]$2')
      .replace(/(access_token=)[^&\s]+/gi, '$1[redacted]')
      .replace(/\b(gsk_[A-Za-z0-9_-]+)\b/g, '[redacted]');
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
          text: redact(element.innerText || element.textContent).slice(0, 800),
          ariaLabel: element.getAttribute('aria-label'),
          title: element.getAttribute('title'),
          placeholder: element.getAttribute('placeholder'),
          type: element.getAttribute('type'),
          state: element.getAttribute('data-state'),
          checked: element.getAttribute('aria-checked'),
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
        };
      })
      .filter((item) => item.rect.x >= 500 && item.rect.y >= 0 && item.rect.y < innerHeight);

    const visibleText = [...document.querySelectorAll('body *')]
      .filter(visible)
      .filter((element) => element.children.length === 0)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return rect.x >= 735 && rect.y >= 45 && rect.y < innerHeight ? redact(element.textContent) : '';
      })
      .filter(Boolean);

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
      text: [...new Set(visibleText)].join(' | ').slice(0, 30000),
      interactive,
      scrollers,
    };
  });
  const screenshot = `reference/base44-dashboard/screenshots/desktop/${name}.png`;
  await page.screenshot({
    path: screenshot,
    fullPage: false,
    animations: 'disabled',
    mask: [page.locator('pre'), page.locator('code')],
  });
  return { ...data, screenshot };
}

async function ensureDashboard(page) {
  const dashboard = page.getByRole('radio', { name: 'Dashboard', exact: true });
  if (await dashboard.count()) {
    await dashboard.click();
    await page.waitForTimeout(700);
  }
  const back = page.getByText('Back to Dashboard', { exact: true });
  if (await back.count()) {
    await back.click();
    await page.waitForTimeout(700);
  }
}

async function observeSection(page, section, filename) {
  await ensureDashboard(page);
  const control = page.getByRole('button', { name: section, exact: true });
  if (!(await control.count())) return { section, status: 'not found' };
  await control.last().click();
  await page.waitForTimeout(1000);
  return { section, status: 'observed', ...(await capture(page, filename)) };
}

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = browser.contexts()[0].pages()[0];
  await page.bringToFront();
  await page.setViewportSize({ width: 1440, height: 900 });
  const results = [];

  await ensureDashboard(page);
  const marketing = page.getByRole('button', { name: 'Marketing', exact: true });
  if (await marketing.count()) {
    await marketing.last().click();
    await page.waitForTimeout(300);
    for (const [section, filename] of [['SEO & GEO', '30-marketing-seo-geo'], ['Social content', '31-marketing-social-content']]) {
      const control = page.getByRole('button', { name: section, exact: true });
      if (await control.count()) {
        await control.last().click();
        await page.waitForTimeout(900);
        results.push({ section, status: 'observed', ...(await capture(page, filename)) });
      } else {
        results.push({ section, status: 'not found' });
      }
      await ensureDashboard(page);
      const again = page.getByRole('button', { name: 'Marketing', exact: true });
      if (await again.count()) {
        await again.last().click();
        await page.waitForTimeout(300);
      }
    }
  }

  for (const [section, filename] of [
    ['Agents', '32-agents'],
    ['Workflows', '33-workflows'],
    ['Logs', '34-logs'],
    ['API', '35-api'],
    ['Settings', '36-settings'],
  ]) {
    results.push(await observeSection(page, section, filename));
  }

  writeFileSync('reference/base44-dashboard/actual/remaining-sections.json', `${JSON.stringify(results, null, 2)}\n`, 'utf8');
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
