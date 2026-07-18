const { chromium } = require('playwright-core');
const { writeFileSync } = require('node:fs');

function redact(value) {
  return (value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/("?api_key"?\s*[:=]\s*["'])[^"']+(["'])/gi, '$1[redacted]$2')
    .replace(/(access_token=)[^&\s]+/gi, '$1[redacted]')
    .replace(/\b(gsk_[A-Za-z0-9_-]+)\b/g, '[redacted]');
}

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
          text: clean(element.innerText || element.textContent).slice(0, 1000),
          ariaLabel: element.getAttribute('aria-label'),
          title: element.getAttribute('title'),
          placeholder: element.getAttribute('placeholder'),
          type: element.getAttribute('type'),
          state: element.getAttribute('data-state'),
          checked: element.getAttribute('aria-checked'),
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
        };
      })
      .filter((item) => item.rect.x >= 735 && item.rect.y >= 45 && item.rect.y < innerHeight);
    const leaves = [...document.querySelectorAll('body *')]
      .filter(visible)
      .filter((element) => element.children.length === 0)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return rect.x >= 735 && rect.y >= 45 && rect.y < innerHeight ? clean(element.textContent) : '';
      })
      .filter(Boolean);
    const scroller = [...document.querySelectorAll('*')]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.x >= 735 && element.scrollHeight > element.clientHeight + 4;
      })
      .sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
    return {
      url: location.href,
      text: [...new Set(leaves)].join(' | ').slice(0, 30000),
      items,
      scroll: scroller ? {
        top: scroller.scrollTop,
        clientHeight: scroller.clientHeight,
        scrollHeight: scroller.scrollHeight,
      } : null,
    };
  });
  data.text = redact(data.text);
  data.items = data.items.map((item) => ({ ...item, text: redact(item.text) }));
  const screenshot = `reference/base44-dashboard/screenshots/desktop/${name}.png`;
  await page.screenshot({ path: screenshot, fullPage: false, animations: 'disabled', mask: [page.locator('pre'), page.locator('code')] });
  return { ...data, screenshot };
}

async function scrollMain(page, ratio) {
  await page.evaluate((value) => {
    const scroller = [...document.querySelectorAll('*')]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.x >= 735 && element.scrollHeight > element.clientHeight + 4;
      })
      .sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
    if (scroller) scroller.scrollTop = Math.round((scroller.scrollHeight - scroller.clientHeight) * value);
  }, ratio);
  await page.waitForTimeout(500);
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

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = browser.contexts()[0].pages()[0];
  await page.bringToFront();
  await page.setViewportSize({ width: 1440, height: 900 });
  const results = [];

  await ensureDashboard(page);
  const settings = page.getByRole('button', { name: 'Settings', exact: true });
  if (await settings.count()) {
    await settings.last().click();
    await page.waitForTimeout(700);
    await scrollMain(page, 0);
    results.push({ state: 'settings-app-top', ...(await capture(page, '40-settings-app-top')) });
    await scrollMain(page, 0.52);
    results.push({ state: 'settings-app-middle', ...(await capture(page, '41-settings-app-middle')) });
    await scrollMain(page, 1);
    results.push({ state: 'settings-app-bottom', ...(await capture(page, '42-settings-app-bottom')) });

    await scrollMain(page, 0);
    const auth = page.getByRole('tab', { name: 'Authentication', exact: true });
    if (await auth.count()) {
      await auth.click();
      await page.waitForTimeout(700);
      results.push({ state: 'settings-auth-top', ...(await capture(page, '43-settings-auth-top')) });
      await scrollMain(page, 1);
      results.push({ state: 'settings-auth-bottom', ...(await capture(page, '44-settings-auth-bottom')) });
    }
  }

  await ensureDashboard(page);
  const marketing = page.getByRole('button', { name: 'Marketing', exact: true });
  if (await marketing.count()) {
    await marketing.last().click();
    await page.waitForTimeout(300);
    const seo = page.getByText('SEO & GEO', { exact: true });
    if (await seo.count()) {
      await seo.last().click();
      await page.waitForTimeout(700);
      for (const [tabName, filename] of [['Meta tags', '45-seo-meta-tags'], ['Advanced Settings', '46-seo-advanced']]) {
        const tab = page.getByRole('tab', { name: tabName, exact: true });
        if (await tab.count()) {
          await tab.click();
          await page.waitForTimeout(500);
          results.push({ state: `seo-${tabName}`, ...(await capture(page, filename)) });
        }
      }
    }
  }

  await ensureDashboard(page);
  const marketingAgain = page.getByRole('button', { name: 'Marketing', exact: true });
  if (await marketingAgain.count()) {
    await marketingAgain.last().click();
    await page.waitForTimeout(300);
  }
  const social = page.getByText('Social content', { exact: true });
  if (await social.count()) {
    await social.last().click();
    await page.waitForTimeout(700);
    results.push({ state: 'social-content', ...(await capture(page, '47-social-content')) });
  } else {
    results.push({ state: 'social-content', status: 'not found' });
  }

  await ensureDashboard(page);
  const workflows = page.getByRole('button', { name: /Workflows/ }).last();
  if (await workflows.count()) {
    await workflows.click();
    await page.waitForTimeout(800);
    results.push({ state: 'workflows', ...(await capture(page, '48-workflows')) });
  } else {
    results.push({ state: 'workflows', status: 'not found' });
  }

  await ensureDashboard(page);
  const logs = page.getByRole('button', { name: 'Logs', exact: true });
  if (await logs.count()) {
    await logs.last().click();
    await page.waitForTimeout(700);
    const expand = page.getByRole('button', { name: 'Expand row', exact: true }).first();
    if (await expand.count()) {
      await expand.click();
      await page.waitForTimeout(400);
      results.push({ state: 'logs-expanded', ...(await capture(page, '49-logs-expanded')) });
    }
  }

  writeFileSync('reference/base44-dashboard/actual/deep-settings.json', `${JSON.stringify(results, null, 2)}\n`, 'utf8');
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
