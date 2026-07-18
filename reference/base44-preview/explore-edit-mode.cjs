const { chromium } = require('playwright-core');
const { writeFileSync } = require('node:fs');

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = browser.contexts()[0].pages()[0];
  await page.bringToFront();
  await page.setViewportSize({ width: 1440, height: 900 });
  const preview = page.getByRole('radio', { name: 'Preview', exact: true });
  if (await preview.count()) {
    await preview.click();
    await page.waitForTimeout(800);
  }
  const edit = page.getByRole('button', { name: 'Edit mode', exact: true });
  const result = { status: 'not found' };
  if (await edit.count()) {
    await edit.click();
    await page.waitForTimeout(5000);
    await page.getByText('Loading your app..', { exact: true }).waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await page.mouse.move(850, 330);
    await page.waitForTimeout(500);
    result.status = 'observed';
    result.url = page.url();
    result.controls = await page.evaluate(() => {
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      return [...document.querySelectorAll('button,[role],input')]
        .filter(visible)
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            text: (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 500),
            role: element.getAttribute('role'),
            ariaLabel: element.getAttribute('aria-label'),
            pressed: element.getAttribute('aria-pressed'),
            rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
          };
        })
        .filter((item) => item.rect.x >= 500 && item.rect.y >= 0 && item.rect.y < innerHeight);
    });
    result.screenshot = 'reference/base44-preview/screenshots/desktop/10-edit-mode-preview.png';
    await page.screenshot({ path: result.screenshot, fullPage: false, animations: 'disabled' });
    const previewMode = page.getByRole('button', { name: 'Preview mode', exact: true });
    if (await previewMode.count()) {
      await previewMode.click();
      await page.waitForTimeout(300);
    }
  }
  writeFileSync('reference/base44-preview/actual/edit-mode.json', `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
