// Dev-скриншоты UI без MCP-браузера. На этом сервере MCP-Firefox падает на D3D11 —
// поэтому гоним Chromium из кэша Playwright с software-рендером (--use-gl=swiftshader).
//
// Использование:
//   node scripts/dev/screenshot.mjs <url> [out.png] [width] [height]
// Пример:
//   node scripts/dev/screenshot.mjs http://localhost:5199/preview.html shot.png 900 700
//
// Требует playwright-core (devDependency) и уже установленный Chromium в кэше ms-playwright
// (его ставит Playwright-MCP). Vite-харнесс поднимай с ОТКЛЮЧЁННЫМ HMR — иначе на этом
// окружении websocket wss://:443 спамит и рендер зависает (см. vite.config.ts → server.hmr).
import { chromium } from 'playwright-core';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// Находим chrome.exe/chrome в кэше ms-playwright (chromium-<build>), не завязываясь на версию.
function findChromium() {
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    join(process.env.LOCALAPPDATA ?? '', 'ms-playwright'),
    join(homedir(), 'AppData', 'Local', 'ms-playwright'),
    join(homedir(), '.cache', 'ms-playwright'),
    join(homedir(), 'Library', 'Caches', 'ms-playwright'),
  ].filter(Boolean);
  const bins = ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium'];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const dirs = readdirSync(root).filter((d) => d.startsWith('chromium-') && !d.includes('headless')).sort().reverse();
    for (const d of dirs) for (const b of bins) {
      const p = join(root, d, b);
      if (existsSync(p)) return p;
    }
  }
  return undefined; // playwright-core попробует свой дефолт
}

const url = process.argv[2];
const out = process.argv[3] || 'shot.png';
const width = Number(process.argv[4] || 900);
const height = Number(process.argv[5] || 700);
if (!url) {
  console.error('usage: node scripts/dev/screenshot.mjs <url> [out.png] [width] [height]');
  process.exit(1);
}

const browser = await chromium.launch({
  executablePath: findChromium(),
  headless: true,
  args: ['--use-gl=swiftshader', '--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
await page.emulateMedia({ reducedMotion: 'reduce' });
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(400);
await page.screenshot({ path: out });
await browser.close();
console.log('screenshot saved:', out);
