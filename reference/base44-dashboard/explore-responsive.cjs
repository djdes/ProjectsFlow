const { chromium } = require('playwright-core');
const { mkdirSync, writeFileSync } = require('node:fs');

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = browser.contexts()[0].pages()[0];
  await page.bringToFront();

  const dashboard = page.getByText('Dashboard', { exact: true }).last();
  if (await dashboard.count()) {
    await dashboard.click();
    await page.waitForTimeout(1000);
  }
  const overview = page.getByRole('button', { name: 'Overview', exact: true }).last();
  if (await overview.count()) {
    await overview.click();
    await page.waitForTimeout(700);
  }

  const results = [];
  for (const viewport of [
    { name: 'tablet', width: 1024, height: 768 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.waitForTimeout(500);
    mkdirSync(`reference/base44-dashboard/screenshots/${viewport.name}`, { recursive: true });
    const path = `reference/base44-dashboard/screenshots/${viewport.name}/01-overview.png`;
    await page.screenshot({ path, fullPage: false, animations: 'disabled' });
    const geometry = await page.evaluate(() => ({
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      body: { width: document.body.scrollWidth, height: document.body.scrollHeight },
      visibleText: (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 3000),
    }));
    results.push({ ...viewport, ...geometry, screenshot: path });
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);
  writeFileSync(
    'reference/base44-dashboard/actual/responsive.json',
    `${JSON.stringify(results, null, 2)}\n`,
    'utf8',
  );
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
