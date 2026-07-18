const { chromium } = require('playwright-core');
const { writeFileSync } = require('node:fs');

function sanitizeControls(controls) {
  return controls.map((control) => ({
    ...control,
    name: control.name.replace(/(?:https?:\/\/)?[^\s]+\.(?:base44|projectsflow)\.[^\s]+/gi, '[redacted-url]'),
  }));
}

async function controls(page) {
  return sanitizeControls(await page.evaluate(() => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    return [...document.querySelectorAll('button,input,[role="button"],[role="tab"],[role="dialog"],[role="menuitem"],[role="tooltip"]')]
      .filter(visible)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          role: element.getAttribute('role'),
          name: (element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent || element.getAttribute('placeholder') || '').replace(/\s+/g, ' ').trim().slice(0, 240),
          pressed: element.getAttribute('aria-pressed'),
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
        };
      })
      .filter((item) => item.rect.x >= 480 && item.rect.y < innerHeight);
  }));
}

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const pages = browser.contexts().flatMap((context) => context.pages());
  const page = pages[2];
  if (!page || !page.url().includes('app.base44.com') || !(await page.title()).includes('Purity Protocol')) {
    throw new Error('Reference tab index 2 was not found');
  }
  await page.bringToFront();
  await page.setViewportSize({ width: 1440, height: 900 });
  const preview = page.getByRole('radio', { name: 'Preview', exact: true });
  if (await preview.count()) await preview.click();
  await page.waitForTimeout(1200);
  const edit = page.getByRole('button', { name: /Edit mode|Preview mode/ }).first();
  if (!(await edit.count())) throw new Error('Edit mode was not found');
  if ((await edit.getAttribute('aria-label')) === 'Edit mode') await edit.click();
  await page.waitForTimeout(6000);
  const beforeSelection = await controls(page);
  await page.mouse.move(900, 120);
  await page.waitForTimeout(800);
  await page.mouse.click(900, 120);
  await page.waitForTimeout(1400);
  const afterSelection = await controls(page);
  const frameControls = [];
  for (const frame of page.frames().filter((candidate) => candidate !== page.mainFrame())) {
    try {
      const items = await frame.evaluate(() => {
        const visible = (element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        };
        return [...document.querySelectorAll('button,input,[role="button"],[role="tab"],[role="dialog"],[role="menuitem"],[role="tooltip"]')]
          .filter(visible)
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              tag: element.tagName.toLowerCase(),
              role: element.getAttribute('role'),
              name: (element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent || element.getAttribute('placeholder') || '').replace(/\s+/g, ' ').trim().slice(0, 240),
              pressed: element.getAttribute('aria-pressed'),
              rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
            };
          });
      });
      if (items.length) frameControls.push({ title: await frame.title(), controls: sanitizeControls(items) });
    } catch {
      // Sandboxed or detached frame; safely skip it.
    }
  }
  writeFileSync('reference/base44-preview/actual/current-edit-inspection.json', `${JSON.stringify({
    identity: { title: await page.title(), url: new URL(page.url()).origin + new URL(page.url()).pathname },
    beforeSelection,
    afterSelection,
    frameControls,
  }, null, 2)}\n`, 'utf8');
  await page.screenshot({
    path: 'reference/base44-preview/screenshots/desktop/11-current-edit-selection.png',
    fullPage: false,
    animations: 'disabled',
  });
  const previewMode = page.getByRole('button', { name: 'Preview mode', exact: true });
  if (await previewMode.count()) await previewMode.click();
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
