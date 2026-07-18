const { chromium } = require('playwright-core');
const { writeFileSync } = require('node:fs');

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = browser.contexts()[0].pages()[0];
  await page.bringToFront();
  await page.setViewportSize({ width: 1440, height: 900 });
  const dashboard = page.getByRole('radio', { name: 'Dashboard', exact: true });
  if (await dashboard.count()) {
    await dashboard.click();
    await page.waitForTimeout(600);
  }
  let social = page.getByText('Social content', { exact: true });
  if (!(await social.count())) {
    const marketing = page.getByRole('button', { name: 'Marketing', exact: true });
    if (await marketing.count()) {
      await marketing.last().click();
      await page.waitForTimeout(300);
      social = page.getByText('Social content', { exact: true });
    }
  }
  const result = { status: 'not found' };
  if (await social.count()) {
    await social.last().click();
    await page.waitForTimeout(900);
    result.status = 'observed';
    result.url = page.url();
    result.text = await page.evaluate(() => {
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      return [...document.querySelectorAll('body *')]
        .filter(visible)
        .filter((element) => element.children.length === 0)
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return rect.x >= 735 && rect.y >= 45 && rect.y < innerHeight ? (element.textContent || '').replace(/\s+/g, ' ').trim() : '';
        })
        .filter(Boolean)
        .filter((value, index, all) => all.indexOf(value) === index)
        .join(' | ')
        .slice(0, 20000);
    });
    result.screenshot = 'reference/base44-dashboard/screenshots/desktop/50-social-content.png';
    await page.screenshot({ path: result.screenshot, fullPage: false, animations: 'disabled' });
  }
  writeFileSync('reference/base44-dashboard/actual/social-content.json', `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
