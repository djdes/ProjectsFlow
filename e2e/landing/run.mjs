#!/usr/bin/env node
// Smoke tests of the landing main page (built landing/dist): content from landing/src/data,
// auth-aware buttons, scroll motion, reduced motion, no-JS, narrow phones and anchor links.
//
//   npm run build:landing && npm run test:landing
//   node e2e/landing/run.mjs --only phone    # only cases whose id contains «phone»
//
// Env: CHROME_PATH (browser binary), SMOKE_ALLOW_SKIP=1 (no browser found → warning, exit 0).

import { createServer } from 'node:http';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const DIST = join(ROOT, 'landing', 'dist');
const SRC = join(ROOT, 'landing', 'src');

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const NARROW = { width: 320, height: 640 };
const CASE_TIMEOUT_MS = 60_000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.webmanifest': 'application/manifest+json',
};

// ------------------------------------------------------------------ cli ----

const argv = process.argv.slice(2);
const onlyArg = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;
const only = (onlyArg ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const useColor = !process.env.NO_COLOR && (process.stdout.isTTY || Boolean(process.env.CI));
const paint = (code) => (text) => (useColor ? `\u001b[${code}m${text}\u001b[0m` : String(text));
const green = paint('32');
const red = paint('31');
const yellow = paint('33');
const dim = paint('2');

// -------------------------------------------------------- static server ----

// Serves landing/dist like the production server: a directory answers with its index.html,
// and the request header `x-test-auth: authed` stands in for the session cookie — the HTML
// gets `data-auth="authed"` on <html> the same way server/src/presentation/public/promoDelivery.ts does it.
function startServer() {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let target = resolve(DIST, `.${decodeURIComponent(url.pathname)}`);
    if (target !== DIST && !target.startsWith(DIST + sep)) {
      res.writeHead(403).end();
      return;
    }
    try {
      if (statSync(target).isDirectory()) target = join(target, 'index.html');
    } catch {
      /* missing file: answered below */
    }
    if (!existsSync(target)) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
      return;
    }
    const type = MIME[extname(target)] ?? 'application/octet-stream';
    let body = readFileSync(target);
    if (type.startsWith('text/html') && req.headers['x-test-auth'] === 'authed') {
      body = Buffer.from(String(body).replace(/<html\b(?![^>]*\bdata-auth=)/i, '<html data-auth="authed"'));
    }
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(body);
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

// -------------------------------------------------------------- browser ----

function cachedChromiumExecutables() {
  const roots = [];
  const custom = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (custom && custom !== '0') roots.push(custom);
  if (process.platform === 'win32') {
    roots.push(join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'ms-playwright'));
  } else if (process.platform === 'darwin') {
    roots.push(join(homedir(), 'Library', 'Caches', 'ms-playwright'));
  } else {
    roots.push(join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'ms-playwright'));
  }
  const binaries = {
    win32: [['chrome-win64', 'chrome.exe'], ['chrome-win', 'chrome.exe']],
    darwin: [['chrome-mac-arm64', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'], ['chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium']],
  }[process.platform] ?? [['chrome-linux64', 'chrome'], ['chrome-linux', 'chrome']];
  const found = [];
  for (const root of roots) {
    let dirs = [];
    try {
      dirs = readdirSync(root).filter((d) => /^chromium-\d+$/.test(d));
    } catch {
      continue;
    }
    dirs.sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const dir of dirs) {
      for (const parts of binaries) {
        const exe = join(root, dir, ...parts);
        if (existsSync(exe)) found.push(exe);
      }
    }
  }
  return found;
}

async function launchBrowser() {
  const attempts = [];
  if (process.env.CHROME_PATH) attempts.push({ label: `CHROME_PATH (${process.env.CHROME_PATH})`, options: { executablePath: process.env.CHROME_PATH } });
  attempts.push({ label: 'Google Chrome', options: { channel: 'chrome' } });
  attempts.push({ label: 'Microsoft Edge', options: { channel: 'msedge' } });
  for (const exe of cachedChromiumExecutables()) attempts.push({ label: `Chromium (${exe})`, options: { executablePath: exe } });
  const failures = [];
  for (const attempt of attempts) {
    try {
      const browser = await chromium.launch({ headless: true, ...attempt.options });
      return { browser, label: `${attempt.label} ${browser.version()}` };
    } catch (error) {
      failures.push(`${attempt.label}: ${String(error.message).split('\n')[0]}`);
    }
  }
  return { browser: null, failures };
}

// -------------------------------------------------------------- helpers ----

const norm = (s) => String(s ?? '').replace(/[\s  ]+/g, ' ').trim();

// Two animation frames, so scroll-driven styles are recomputed. With JavaScript disabled the page
// runs no rAF callbacks at all, hence the time cap.
async function settle(page) {
  const frames = page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)))).catch(() => {});
  await Promise.race([frames, new Promise((ok) => setTimeout(ok, 300))]);
}

async function scrollToY(page, y) {
  await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), y);
  await settle(page);
  await page.waitForTimeout(60);
  await settle(page);
}

async function waitScrollStable(page) {
  let last = -1;
  for (let i = 0; i < 40; i += 1) {
    const y = await page.evaluate(() => window.scrollY);
    if (y === last) return y;
    last = y;
    await page.waitForTimeout(100);
  }
  return last;
}

// Numeric custom property written by the motion script (NaN when it was never written).
async function cssNumber(page, selector, name) {
  return page.evaluate(([sel, prop]) => {
    const el = document.querySelector(sel);
    return el ? parseFloat(getComputedStyle(el).getPropertyValue(prop)) : NaN;
  }, [selector, name]);
}

// Visible link texts inside each zone (display:none / zero-size elements are not visible).
async function visibleLinks(page) {
  return page.evaluate(() => {
    const isVisible = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    };
    const zone = (sel) =>
      [...document.querySelectorAll(`${sel} a`)]
        .filter(isVisible)
        .map((a) => ({ text: (a.textContent ?? '').replace(/\s+/g, ' ').trim(), href: a.getAttribute('href') }));
    return { header: zone('header.nav'), hero: zone('.hero__actions'), final: zone('.final') };
  });
}

// Things a person must be able to see and click. For each element matched by `selector` (and
// rendered), is there a scroll position — scanned in steps between `from` and `to` — where its
// centre is on screen, it is at least half opaque, and it is the topmost element there?
// Returns the labels of the elements never reachable.
async function unreachable(page, selector, { from = 0, to = Infinity, step = 40 } = {}) {
  const max = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  const end = Math.max(0, Math.min(to, max));
  const reached = new Set();
  let labels = [];
  for (let y = Math.max(0, Math.min(from, end)); ; y = Math.min(y + step, end)) {
    await scrollToY(page, y);
    const res = await page.evaluate((sel) => {
      const effective = (el) => {
        let o = 1;
        for (let a = el; a; a = a.parentElement) o *= parseFloat(getComputedStyle(a).opacity);
        return o;
      };
      const els = [...document.querySelectorAll(sel)].filter((el) => el.getBoundingClientRect().width > 0);
      return {
        labels: els.map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 32) || String(el.className)),
        hits: els
          .map((el, i) => {
            const r = el.getBoundingClientRect();
            const x = r.left + r.width / 2;
            const yy = r.top + r.height / 2;
            if (x < 0 || x > window.innerWidth || yy < 0 || yy > window.innerHeight || effective(el) < 0.5) return -1;
            const hit = document.elementFromPoint(x, yy);
            return hit && (hit === el || el.contains(hit)) ? i : -1;
          })
          .filter((i) => i >= 0),
      };
    }, selector);
    labels = res.labels;
    res.hits.forEach((i) => reached.add(i));
    if (reached.size === labels.length || y >= end) break;
  }
  return labels.filter((_, i) => !reached.has(i));
}

// Waits for an anchor jump to land: the section's top reaches its own scroll-margin. The jump can be
// smooth and start several frames late where frames are slow (CI renders without a GPU), so sampling
// the scroll position and calling two equal reads «done» returned before the scroll had even begun.
async function waitAnchored(page, id, timeout = 8000) {
  await page
    .waitForFunction(
      (sel) => {
        const sec = document.getElementById(sel);
        return Boolean(sec) && Math.abs(sec.getBoundingClientRect().top - parseFloat(getComputedStyle(sec).scrollMarginBlockStart)) <= 3;
      },
      id,
      { timeout, polling: 100 },
    )
    .catch(() => {});
  await waitScrollStable(page);
}

// Where a section ended up after an anchor jump, against its own scroll-margin.
async function anchorReport(page, id) {
  return page.evaluate((sel) => {
    const sec = document.getElementById(sel);
    const heading = sec.querySelector('.h2, .h1');
    return {
      y: Math.round(window.scrollY),
      top: Math.round(sec.getBoundingClientRect().top),
      margin: parseFloat(getComputedStyle(sec).scrollMarginBlockStart),
      header: Math.round(document.querySelector('header.nav').getBoundingClientRect().bottom),
      heading: Math.round(heading.getBoundingClientRect().top),
    };
  }, id);
}

// Gaps between the texts of neighbouring header section links (px).
async function linkGaps(page) {
  return page.evaluate(() => {
    const boxes = [...document.querySelectorAll('.nav__links a')].map((a) => {
      const range = document.createRange();
      range.selectNodeContents(a);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0);
      return { left: Math.min(...rects.map((r) => r.left)), right: Math.max(...rects.map((r) => r.right)) };
    });
    return boxes.slice(1).map((b, i) => Math.round(b.left - boxes[i].right));
  });
}

// Horizontal overflow: the document must not scroll sideways, and no element may stick out of
// the screen unless an intentional clipper/scroller (marquee, the pin strip, the nav row) holds it.
async function overflowReport(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const pageLevel = (el) => el.matches('html, body, .pf, main, .intro');
    const clipped = (el) => {
      for (let a = el.parentElement; a; a = a.parentElement) {
        if (pageLevel(a)) continue;
        if (getComputedStyle(a).overflowX !== 'visible') return true;
      }
      return false;
    };
    const bad = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.right <= vw + 1 && r.left >= -1) continue;
      if (getComputedStyle(el).position === 'fixed' && el.closest('[aria-hidden="true"]')) continue;
      if (clipped(el)) continue;
      const cls = typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).join('.')}` : '';
      bad.push(`${el.tagName.toLowerCase()}${cls} ${Math.round(r.left)}…${Math.round(r.right)}`);
    }
    return { vw, scrollWidth: document.documentElement.scrollWidth, bad: bad.slice(0, 8) };
  });
}

// ---------------------------------------------------------------- cases ----

function checkData({ check }) {
  const md = existsSync(join(DIST, 'index.md')) ? readFileSync(join(DIST, 'index.md'), 'utf8') : '';
  check('/index.md: раздел «Как это работает»', md.includes('## Как это работает'));
  check('/index.md: раздел «Возможности»', md.includes('## Возможности'));
  check('/index.md: раздел «Гарантии»', md.includes('## Гарантии'));
  const full = existsSync(join(DIST, 'llms-full.txt')) ? readFileSync(join(DIST, 'llms-full.txt'), 'utf8') : '';
  check('/llms-full.txt: раздел «Как это работает»', full.includes('Как это работает'));
  const grep = (dir) =>
    readdirSync(dir, { withFileTypes: true }).some((d) =>
      d.isDirectory() ? grep(join(dir, d.name)) : /\.(ts|tsx|astro|mjs)$/.test(d.name) && readFileSync(join(dir, d.name), 'utf8').includes('STACK_LAYERS'),
    );
  check('старая витрина удалена (showcase/*, showcaseData.ts, STACK_LAYERS)', !existsSync(join(SRC, 'components', 'showcase')) && !existsSync(join(SRC, 'data', 'showcaseData.ts')) && !grep(SRC));
  const astroDir = join(DIST, '_astro');
  const reactBundles = existsSync(astroDir) ? readdirSync(astroDir).filter((f) => /^client\..*\.js$/.test(f)) : [];
  check('в сборке нет React-бандла (старой витрины нет целиком)', reactBundles.length === 0, reactBundles.join(', '));
}

async function desktopStructure({ page, check }) {
  await page.evaluate(() => document.fonts.ready);
  const info = await page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const text = (el) => (el?.textContent ?? '').replace(/[\s  ]+/g, ' ').trim();
    const ld = [...document.querySelectorAll('script[type="application/ld+json"]')].flatMap((s) => {
      try {
        const v = JSON.parse(s.textContent ?? '');
        return Array.isArray(v) ? v : [v];
      } catch {
        return [];
      }
    });
    return {
      root: q('.pf')?.className ?? '',
      h1: text(q('h1')),
      navHrefs: [...document.querySelectorAll('.nav__links a')].map((a) => a.getAttribute('href')),
      plans: [...document.querySelectorAll('.plan')].map((p) => ({
        name: text(p.querySelector('.plan__name')),
        price: text(p.querySelector('.plan__num')),
        cta: text(p.querySelector('.btn')),
        edge: Boolean(p.querySelector('.edge')),
        trial: text(p.querySelector('.plan__trial')),
        items: p.querySelectorAll('.plan__list li').length,
      })),
      faq: [...document.querySelectorAll('details.faq__item')].map((d) => d.open),
      ldTypes: ld.map((x) => x['@type']),
      faqLd: ld.find((x) => x['@type'] === 'FAQPage')?.mainEntity?.length ?? 0,
      offers: ld.find((x) => x['@type'] === 'SoftwareApplication')?.offers?.length ?? 0,
      themeColor: q('meta[name="theme-color"]')?.getAttribute('content') ?? '',
      words: document.querySelectorAll('.statement__text .lw').length,
      wordTokens: (q('.statement__text')?.textContent ?? '').trim().split(/\s+/).filter(Boolean).length,
      facts: document.querySelectorAll('.hero .stats .stat').length,
      statsBottom: q('.hero .stats')?.getBoundingClientRect().bottom ?? Infinity,
      split: (() => {
        const t = q('.hero__text')?.getBoundingClientRect();
        const v = q('.hero__visual')?.getBoundingClientRect();
        return t && v ? { textRight: Math.round(t.right), visualLeft: Math.round(v.left), visualTop: Math.round(v.top), textTop: Math.round(t.top) } : null;
      })(),
      btnIcons: ['.hero__actions', '.how__sticky', '.final .actions'].map((sel) => document.querySelectorAll(`${sel} a.btn .btn__ic`).length),
      steps: document.querySelectorAll('.step').length,
      details: document.querySelectorAll('.pin__track .fc').length,
      guarantees: document.querySelectorAll('.guar li').length,
      platformCards: document.querySelectorAll('#platforms .fan .pcard').length,
      marquee: document.querySelectorAll('.marquee').length,
      posts: document.querySelectorAll('.foot a[href^="/blog/"]').length,
      font: document.fonts.check('500 32px "Inter Variable"'),
    };
  });
  check('скрипт движения включил .pf--motion', info.root.includes('pf--motion'), info.root);
  check('заголовок «Опиши идею. Получи готовый продукт.»', info.h1.includes('Опиши идею.') && info.h1.includes('Получи готовый продукт.'), info.h1);
  check('разделы шапки: #features #how #pricing #faq /blog', info.navHrefs.join(' ') === '#features #how #pricing #faq /blog', info.navHrefs.join(' '));
  check('три тарифа из pricing.ts', info.plans.map((p) => p.name).join('|') === 'Бесплатный|Прайм|VIP', info.plans.map((p) => p.name).join('|'));
  check('цены 0 ₽ / 1 900 ₽ / 3 900 ₽', info.plans.map((p) => p.price).join('|') === '0 ₽|1 900 ₽|3 900 ₽', info.plans.map((p) => p.price).join('|'));
  check('у «Прайма» цветная обводка и пробный час', info.plans[1]?.edge && info.plans[1]?.trial === 'Попробовать 1 час бесплатно', JSON.stringify(info.plans[1]));
  check('VIP: кнопка «Оставить заявку»', info.plans[2]?.cta === 'Оставить заявку', info.plans[2]?.cta);
  check('по 4 пункта в каждом тарифе', info.plans.length === 3 && info.plans.every((p) => p.items === 4));
  check('7 вопросов <details>, открыт только первый', info.faq.length === 7 && info.faq[0] && info.faq.slice(1).every((o) => !o), JSON.stringify(info.faq));
  check('JSON-LD: Organization, WebSite, SoftwareApplication, FAQPage', ['Organization', 'WebSite', 'SoftwareApplication', 'FAQPage'].every((t) => info.ldTypes.includes(t)), info.ldTypes.join(','));
  check('JSON-LD: 7 вопросов и 3 предложения', info.faqLd === 7 && info.offers === 3, `${info.faqLd}/${info.offers}`);
  check('theme-color #000000', info.themeColor === '#000000', info.themeColor);
  check('первый экран: текст слева, окно доски справа', info.split && info.split.visualLeft >= info.split.textRight - 1, JSON.stringify(info.split));
  check('полоса из 4 фактов внизу первого экрана', info.facts === 4 && info.statsBottom <= 901, `${info.facts} ${info.statsBottom}`);
  check('кнопки-пилюли с круглой стрелкой (первый экран, шаги, финал)', info.btnIcons.every((n) => n >= 1), info.btnIcons.join(','));
  check('фраза по словам (столько же .lw, сколько слов), 4 факта, 4 шага, 8 мелочей, 4 гарантии', info.words > 0 && info.words === info.wordTokens && info.facts === 4 && info.steps === 4 && info.details === 8 && info.guarantees === 4, JSON.stringify(info));
  check('в подвале 3 свежие статьи', info.posts === 3, String(info.posts));
  check('«Где работает»: веер из 5 карточек вместо бегущей строки', info.platformCards === 5 && info.marquee === 0, `${info.platformCards} / marquee ${info.marquee}`);
  check('шрифт Inter Variable загружен', info.font);
  const scheme = await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);
  check('светлая тема ОС: у чёрной страницы тёмные полосы прокрутки (color-scheme: dark)', scheme === 'dark', scheme);
}

async function desktopMotion({ page, check }) {
  const headWords = await page.evaluate(() => document.querySelectorAll('#features .h2 .w').length);
  check('заголовки размечены по словам (.w)', headWords >= 3, String(headWords));

  await scrollToY(page, 0);
  const h0 = await cssNumber(page, '.hero', '--h');
  // A first screen taller than the window scrolls -heroTop px before it sticks and starts to recede.
  const heroTop = (await cssNumber(page, '.hero', '--hero-top')) || 0;
  await scrollToY(page, -heroTop + DESKTOP.height * 0.85 + 10);
  const h1 = await cssNumber(page, '.hero', '--h');
  check('первый экран: --h от 0 до 1 за 85% высоты после того, как экран встал', h0 === 0 && h1 >= 0.99, `${h0} → ${h1} (hero-top ${heroTop})`);

  const how = await page.evaluate(() => {
    const el = document.querySelector('#how');
    const r = el.getBoundingClientRect();
    return { top: r.top + window.scrollY, height: r.height };
  });
  let maxC = 0;
  for (let y = how.top; y < how.top + how.height; y += 90) {
    await scrollToY(page, y);
    maxC = Math.max(maxC, await cssNumber(page, '.step', '--c'));
    if (maxC >= 0.9) break;
  }
  // Stacked cards stay 22px apart (sticky offsets), so --c tops out at about 1 - 22/height.
  check('шаги ложатся стопкой (первый шаг накрыт следующим, --c ≥ 0.9)', maxC >= 0.9, String(maxC));

  const pin = await page.evaluate(() => {
    const el = document.querySelector('.pin');
    const r = el.getBoundingClientRect();
    return { top: r.top + window.scrollY, height: r.height };
  });
  await scrollToY(page, pin.top + (pin.height - DESKTOP.height) / 2);
  const tx = await page.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector('.pin__track')).transform).m41);
  const pp = await cssNumber(page, '.pin', '--pp');
  check('«Мелочи»: при прокрутке вниз лента едет вбок', tx < -50 && pp > 0.3 && pp < 0.7, `x=${tx} pp=${pp}`);

  await scrollToY(page, 0);
  const wordStyle = () => page.evaluate(() => {
    const w = document.querySelector('#faq .h2 .w');
    if (!w) return null;
    const s = getComputedStyle(w);
    return { opacity: parseFloat(s.opacity), filter: s.filter };
  });
  const before = await wordStyle();
  await page.evaluate(() => document.querySelector('#faq .h2').scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.waitForTimeout(1500);
  const after = await wordStyle();
  check('слова заголовка проступают из размытия, когда он въезжает в экран', before && before.opacity < 0.1 && before.filter.includes('blur') && after.opacity > 0.99 && after.filter === 'none', `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
  await page.evaluate(() => document.querySelector('.statement__text').scrollIntoView({ block: 'center', behavior: 'instant' }));
  await settle(page);
  await page.waitForTimeout(700);
  const lit = await page.evaluate(() => ({ on: document.querySelectorAll('.statement__text .lw.on').length, all: document.querySelectorAll('.statement__text .lw').length }));
  check('слова главной фразы загораются по прокрутке (.on)', lit.on > 0 && lit.on <= lit.all, JSON.stringify(lit));

  await page.evaluate(() => document.querySelector('#platforms .fan').scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.waitForTimeout(1600);
  const angles = await page.evaluate(() => [...document.querySelectorAll('#platforms .pcard')].map((c) => {
    const m = new DOMMatrix(getComputedStyle(c).transform);
    return Math.round((Math.atan2(m.b, m.a) * 180) / Math.PI);
  }));
  check('веер раскрывается, когда въезжает в экран (крайние карточки повёрнуты ≥ 15°)', angles.length === 5 && Math.abs(angles[0]) >= 15 && Math.abs(angles[4]) >= 15 && angles[0] < 0 && angles[4] > 0, angles.join(', '));

  await scrollToY(page, await page.evaluate(() => document.documentElement.scrollHeight));
  const r = await cssNumber(page, '.foot', '--r');
  check('подвал выезжает из-под страницы (--r = 1 внизу)', r >= 0.95, String(r));
}

async function anonButtons({ page, check }) {
  const z = await visibleLinks(page);
  const texts = (list) => list.map((l) => l.text);
  check('гость: в шапке «Войти» и «Начать бесплатно»', texts(z.header).includes('Войти') && texts(z.header).includes('Начать бесплатно') && !texts(z.header).includes('Открыть приложение'), texts(z.header).join(' | '));
  check('гость: на первом экране «Начать бесплатно»', texts(z.hero).includes('Начать бесплатно') && !texts(z.hero).includes('Открыть приложение'), texts(z.hero).join(' | '));
  check('гость: в финале «Начать бесплатно» и «Войти»', texts(z.final).includes('Начать бесплатно') && texts(z.final).includes('Войти'), texts(z.final).join(' | '));
}

async function authedButtons({ page, check }) {
  const authed = await page.evaluate(() => document.documentElement.dataset.auth);
  check('сервер пометил вход (data-auth="authed")', authed === 'authed', String(authed));
  const z = await visibleLinks(page);
  const texts = (list) => list.map((l) => l.text);
  const appLink = (list) => list.find((l) => l.text === 'Открыть приложение');
  for (const [zone, label] of [['header', 'в шапке'], ['hero', 'на первом экране'], ['final', 'в финале']]) {
    const t = texts(z[zone]);
    check(`вошедший: ${label} «Открыть приложение» вместо «Войти» / «Начать бесплатно»`, Boolean(appLink(z[zone])) && /\/$/.test(appLink(z[zone])?.href ?? '') && !t.includes('Войти') && !t.includes('Начать бесплатно'), t.join(' | '));
  }
}

async function reducedMotion({ page, check }) {
  await page.waitForTimeout(400);
  const root = await page.evaluate(() => document.querySelector('.pf')?.className ?? '');
  check('reduce: .pf--static', root.includes('pf--static') && !root.includes('pf--motion'), root);
  const anims = await page.evaluate(() => document.getAnimations().map((a) => a.animationName || a.constructor.name));
  check('reduce: ни одной анимации', anims.length === 0, anims.slice(0, 6).join(', '));
  await page.evaluate(() => document.querySelector('#faq .h2').scrollIntoView({ block: 'center', behavior: 'instant' }));
  await settle(page);
  const txt = await page.evaluate(() => {
    const s = getComputedStyle(document.querySelector('#faq .h2'));
    const w = getComputedStyle(document.querySelector('.statement__text .lw'));
    return { opacity: s.opacity, filter: s.filter, word: w.opacity };
  });
  check('reduce: текст не размыт и не прозрачен', txt.opacity === '1' && txt.filter === 'none' && txt.word === '1', JSON.stringify(txt));
  const hiddenBits = await page.evaluate(() => [...document.querySelectorAll('main .w, main .rb, .statement__text .lw')]
    .filter((el) => getComputedStyle(el).opacity !== '1' || getComputedStyle(el).filter !== 'none').length);
  const totalBits = await page.evaluate(() => document.querySelectorAll('main .w, main .rb').length);
  check('reduce: все слова и блоки видны сразу', totalBits > 0 && hiddenBits === 0, `${hiddenBits} из ${totalBits}`);
  const pin = await page.evaluate(() => {
    const track = document.querySelector('.pin__track');
    return {
      transform: getComputedStyle(track).transform,
      overflowX: getComputedStyle(track).overflowX,
      scrollable: track.scrollWidth > track.clientWidth + 10,
    };
  });
  check('reduce: «Мелочи» — обычная горизонтальная прокрутка', pin.transform === 'none' && ['auto', 'scroll'].includes(pin.overflowX) && pin.scrollable, JSON.stringify(pin));
  await scrollToY(page, 600);
  const hero = await page.evaluate(() => getComputedStyle(document.querySelector('.hero__in')).opacity);
  check('reduce: первый экран не гаснет при прокрутке', hero === '1', hero);
}

async function noScript({ page, check }) {
  const root = await page.evaluate(() => document.querySelector('.pf')?.className ?? '');
  check('без JS: классов движения нет', root.includes('pf') && !root.includes('pf--motion') && !root.includes('pf--static'), root);
  // The CSS-only intro of the first screen (blur → sharp) lasts about two seconds.
  await page.waitForTimeout(2300);
  const hidden = await page.evaluate(() => {
    const effective = (el) => {
      let o = 1;
      for (let a = el; a; a = a.parentElement) o *= parseFloat(getComputedStyle(a).opacity);
      return o;
    };
    return [...document.querySelectorAll('main h1, main h2, main h3, main p, main li, .statement__text .lw, main .w, main .rb')]
      .filter((el) => !el.closest('[aria-hidden="true"], .win, details:not([open]) .faq__a'))
      .filter((el) => effective(el) < 0.99 || getComputedStyle(el).filter !== 'none')
      .slice(0, 8)
      .map((el) => `${el.tagName.toLowerCase()} «${(el.textContent ?? '').trim().slice(0, 28)}» ${effective(el).toFixed(2)} ${getComputedStyle(el).filter}`);
  });
  check('без JS: весь текст виден (нет скрытых стартовых состояний)', hidden.length === 0, hidden.join('; '));
  const second = 'details.faq__item:nth-of-type(2)';
  const closedBefore = await page.evaluate((sel) => document.querySelector(sel)?.open === false, second);
  await page.click(`${second} summary`);
  const openAfter = await page.evaluate((sel) => document.querySelector(sel)?.open === true, second);
  check('без JS: вопрос раскрывается по клику', closedBefore && openAfter);
  const pin = await page.evaluate(() => {
    const track = document.querySelector('.pin__track');
    return track ? ['auto', 'scroll'].includes(getComputedStyle(track).overflowX) && track.scrollWidth > track.clientWidth + 10 : false;
  });
  check('без JS: «Мелочи» листаются вбок', pin);
}

async function phone390({ page, check }) {
  await page.evaluate(() => document.fonts.ready);
  const o = await overflowReport(page);
  check('390: нет прокрутки вбок', o.scrollWidth <= o.vw && o.bad.length === 0, `${o.scrollWidth}/${o.vw} ${o.bad.join('; ')}`);
  const nav = await page.evaluate(() => {
    const brand = document.querySelector('.nav .brand').getBoundingClientRect();
    const links = [...document.querySelectorAll('.nav__links a')].map((a) => a.getBoundingClientRect());
    return { brandBottom: brand.bottom, linksTop: Math.min(...links.map((r) => r.top)), lefts: links.map((r) => r.left), rights: links.map((r) => r.right), vw: document.documentElement.clientWidth };
  });
  check('390: разделы строкой под логотипом', nav.linksTop >= nav.brandBottom - 1, JSON.stringify(nav));
  check('390: все пять разделов помещаются', nav.rights.length === 5 && nav.rights.every((r) => r <= nav.vw + 0.5) && nav.lefts.every((l) => l >= -0.5), JSON.stringify(nav.rights));
  const gaps = await linkGaps(page);
  check('390: разделы не слипаются (между ними ≥ 8px)', gaps.every((g) => g >= 8), gaps.join(', '));
  const lay = await page.evaluate(() => {
    const t = document.querySelector('.hero__text')?.getBoundingClientRect();
    const v = document.querySelector('.hero__visual')?.getBoundingClientRect();
    const s = [...document.querySelectorAll('.hero .stats .stat')].map((e) => Math.round(e.getBoundingClientRect().top));
    return { textBottom: t ? Math.round(t.bottom) : null, visualTop: v ? Math.round(v.top) : null, stats: s };
  });
  check('390: окно доски под текстом, факты в две колонки', lay.textBottom !== null && lay.visualTop >= lay.textBottom - 1 && lay.stats.length === 4 && lay.stats[0] === lay.stats[1] && lay.stats[2] > lay.stats[0], JSON.stringify(lay));
}

async function phone320({ page, check }) {
  await page.evaluate(() => document.fonts.ready);
  const o = await overflowReport(page);
  check('320: нет прокрутки вбок', o.scrollWidth <= o.vw && o.bad.length === 0, `${o.scrollWidth}/${o.vw} ${o.bad.join('; ')}`);
  const geo = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const pill = document.querySelector('.announce').getBoundingClientRect();
    const row = document.querySelector('.nav__links');
    return { vw, pill: [pill.left, pill.right], rowOverflow: getComputedStyle(row).overflowX, row: [row.getBoundingClientRect().left, row.getBoundingClientRect().right] };
  });
  check('320: пилюля-анонс помещается', geo.pill[0] >= 0 && geo.pill[1] <= geo.vw, JSON.stringify(geo.pill));
  const rows = await page.evaluate(() => {
    const brand = document.querySelector('.nav .brand').getBoundingClientRect();
    const cta = [...document.querySelectorAll('.nav__cta')].find((a) => a.getBoundingClientRect().width > 0).getBoundingClientRect();
    return { brandTop: Math.round(brand.top), ctaTop: Math.round(cta.top), ctaRight: Math.round(cta.right), header: Math.round(document.querySelector('header.nav').getBoundingClientRect().height) };
  });
  check('320: логотип и кнопка в одной строке, шапка в две строки', Math.abs(rows.brandTop + 8 - rows.ctaTop) <= 12 && rows.ctaRight <= 320 && rows.header <= 110, JSON.stringify(rows));
  check('320: строка разделов прокручивается сама и не шире экрана', ['auto', 'scroll'].includes(geo.rowOverflow) && geo.row[0] >= -0.5 && geo.row[1] <= geo.vw + 0.5, JSON.stringify(geo));
  const gaps = await linkGaps(page);
  check('320: разделы не слипаются (между ними ≥ 8px)', gaps.every((g) => g >= 8), gaps.join(', '));
}

async function anchors({ page, check, baseUrl }) {
  for (const id of ['pricing', 'faq']) {
    await page.goto(`${baseUrl}/#${id}`, { waitUntil: 'load' });
    await waitAnchored(page, id);
    const r = await anchorReport(page, id);
    check(`/#${id}: раздел встаёт ровно под фиксированную шапку`, r.y > 0 && Math.abs(r.top - r.margin) <= 3 && r.heading >= r.header - 1, JSON.stringify(r));
  }
}

// Every link to a section of the main page (/#id from the journal, #id on the page) must hit a real id.
function checkAnchorTargets({ check }) {
  const index = readFileSync(join(DIST, 'index.html'), 'utf8');
  const ids = new Set([...index.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const bad = [];
  const walk = (dir) => {
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      const file = join(dir, d.name);
      if (d.isDirectory()) walk(file);
      else if (d.name.endsWith('.html')) {
        for (const m of readFileSync(file, 'utf8').matchAll(/href="\/#([^"]+)"/g)) {
          if (!ids.has(m[1])) bad.push(`${relative(DIST, file)} → /#${m[1]}`);
        }
      }
    }
  };
  walk(DIST);
  for (const m of index.matchAll(/href="#([^"]+)"/g)) if (!ids.has(m[1])) bad.push(`index.html → #${m[1]}`);
  check('все ссылки на разделы главной (из журнала и с главной) ведут на существующий раздел', bad.length === 0, [...new Set(bad)].slice(0, 6).join('; '));
}

const sizeLabel = (c) => `${c.viewport.width}×${c.viewport.height}`;

async function shortHero({ page, check, c }) {
  await page.evaluate(() => document.fonts.ready);
  // The first-screen intro (blur → sharp, up to ~1.9 s) has to finish before the buttons count as seen.
  await page.waitForTimeout(2300);
  await settle(page);
  const missing = await unreachable(page, '.hero__actions a, .hero__note', { to: c.viewport.height * 1.5 });
  check(`${sizeLabel(c)}: кнопки и подпись первого экрана видны и нажимаются`, missing.length === 0, missing.join(' | '));
}

async function shortFooter({ page, check, c }) {
  await page.evaluate(() => document.fonts.ready);
  const from = await page.evaluate(() => document.querySelector('.foot').getBoundingClientRect().top + window.scrollY - window.innerHeight);
  const missing = await unreachable(page, '.foot a, .foot__h, .foot__brand p', { from });
  check(`${sizeLabel(c)}: весь подвал можно увидеть и нажать`, missing.length === 0, missing.join(' | '));
}

async function shortPhone(ctx) {
  await shortHero(ctx);
  await shortFooter(ctx);
}

async function landscape(ctx) {
  const { page, check, c } = ctx;
  await shortHero(ctx);
  const steps = await unreachable(page, '.step h3, .step p');
  check(`${sizeLabel(c)}: тексты шагов видны`, steps.length === 0, steps.join(' | '));
  const strip = await page.evaluate(() => {
    const track = document.querySelector('.pin__track');
    return { position: getComputedStyle(document.querySelector('.pin__in')).position, overflowX: getComputedStyle(track).overflowX, scrollable: track.scrollWidth > track.clientWidth + 10 };
  });
  check(`${sizeLabel(c)}: «Мелочи» не закрепляются выше экрана, лента листается вбок`, strip.position !== 'sticky' && ['auto', 'scroll'].includes(strip.overflowX) && strip.scrollable, JSON.stringify(strip));
  await shortFooter(ctx);
}

async function reducedPhone({ page, check }) {
  const r = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    return [...document.querySelectorAll('#platforms .pcard')].map((c) => {
      const b = c.getBoundingClientRect();
      const m = new DOMMatrix(getComputedStyle(c).transform);
      return { name: (c.querySelector('.pcard__t')?.textContent ?? '').trim(), inside: b.left >= -0.5 && b.right <= vw + 0.5, angle: Math.round((Math.atan2(m.b, m.a) * 180) / Math.PI) };
    });
  });
  const outside = r.filter((x) => !x.inside).map((x) => x.name);
  const tops = await page.evaluate(() => [...document.querySelectorAll('#platforms .pcard')].map((c) => Math.round(c.getBoundingClientRect().top)));
  check('reduce, 390: колода раскрыта сразу (карты лесенкой), все пять в пределах экрана', r.length === 5 && outside.length === 0 && tops.every((t, i) => i === 0 || t - tops[i - 1] >= 40), `${outside.join(' | ')} tops ${tops.join(',')}`);
}

async function iosToolbar({ page, check }) {
  await page.evaluate(() => document.fonts.ready);
  await settle(page);
  const read = () => page.evaluate(() => ({
    pin: document.querySelector('.pin').offsetHeight,
    pricing: Math.round(document.querySelector('#pricing').getBoundingClientRect().top + window.scrollY),
  }));
  const before = await read();
  // Safari on iOS: the toolbar collapses while scrolling — innerHeight grows and resize fires, the small viewport (svh) stays.
  await page.evaluate(() => {
    const h = window.innerHeight + 81;
    Object.defineProperty(window, 'innerHeight', { configurable: true, get: () => h });
    window.dispatchEvent(new Event('resize'));
  });
  await settle(page);
  await page.waitForTimeout(100);
  await settle(page);
  const after = await read();
  check('iOS: свернувшаяся панель Safari (innerHeight +81) не сдвигает страницу ниже «Мелочей»', before.pin === after.pin && before.pricing === after.pricing, `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
}

async function freshAnchor({ page, check, c }) {
  await page.evaluate(() => document.fonts.ready);
  const id = c.path.split('#')[1];
  await waitAnchored(page, id);
  const r = await anchorReport(page, id);
  check(`открыть ${c.path} (шрифты медленные): раздел встаёт ровно под шапку`, r.y > 0 && Math.abs(r.top - r.margin) <= 3 && r.heading >= r.header - 1, JSON.stringify(r));
}

async function fromBlog({ page, check }) {
  await page.click('nav[aria-label="Основная навигация"] a[href="/#pricing"]');
  await page.waitForURL(/\/#pricing$/);
  await page.waitForLoadState('load');
  await page.evaluate(() => document.fonts.ready);
  await waitAnchored(page, 'pricing');
  const r = await anchorReport(page, 'pricing');
  check('из журнала по ссылке «Тарифы»: раздел встаёт ровно под шапку', r.y > 0 && Math.abs(r.top - r.margin) <= 3 && r.heading >= r.header - 1, JSON.stringify(r));
}

const CASES = [
  { id: 'data', title: 'данные: /index.md, /llms-full.txt, без старой витрины', fsOnly: true, run: checkData },
  { id: 'desktop', title: 'ПК 1440: разметка и данные', viewport: DESKTOP, run: desktopStructure },
  { id: 'desktop-motion', title: 'ПК 1440: движение при прокрутке', viewport: DESKTOP, run: desktopMotion },
  { id: 'anon', title: 'ПК 1440: гость', viewport: DESKTOP, run: anonButtons },
  { id: 'authed-desktop', title: 'ПК 1440: вошедший', viewport: DESKTOP, authed: true, run: authedButtons },
  { id: 'authed-phone', title: 'телефон 390: вошедший', viewport: PHONE, authed: true, run: authedButtons },
  { id: 'reduced-motion', title: 'ПК 1440: prefers-reduced-motion', viewport: DESKTOP, reducedMotion: 'reduce', run: reducedMotion },
  { id: 'no-js', title: 'ПК 1440: без JavaScript', viewport: DESKTOP, javaScript: false, run: noScript },
  { id: 'phone-390', title: 'телефон 390', viewport: PHONE, run: phone390 },
  { id: 'phone-320', title: 'телефон 320', viewport: NARROW, run: phone320 },
  { id: 'phone-320-authed', title: 'телефон 320: вошедший', viewport: NARROW, authed: true, run: phone320 },
  { id: 'anchors-desktop', title: 'ПК 1440: якоря /#pricing, /#faq', viewport: DESKTOP, run: anchors },
  { id: 'anchors-phone', title: 'телефон 390: якоря /#pricing, /#faq', viewport: PHONE, run: anchors },
  { id: 'anchors-narrow', title: 'телефон 320: якоря /#pricing, /#faq', viewport: NARROW, run: anchors },
  { id: 'anchor-targets', title: 'ссылки на разделы главной', fsOnly: true, run: checkAnchorTargets },
  { id: 'fresh-faq', title: 'ПК: открыть /#faq с медленными шрифтами', viewport: DESKTOP, path: '/#faq', delayFonts: 800, run: freshAnchor },
  { id: 'fresh-start', title: 'ПК: открыть /#start с медленными шрифтами', viewport: DESKTOP, path: '/#start', delayFonts: 800, run: freshAnchor },
  { id: 'fresh-pricing-phone', title: 'телефон 390: открыть /#pricing с медленными шрифтами', viewport: PHONE, path: '/#pricing', delayFonts: 800, run: freshAnchor },
  { id: 'from-blog', title: 'ПК: из журнала в «Тарифы»', viewport: DESKTOP, path: '/blog/', delayFonts: 800, run: fromBlog },
  { id: 'short-1366', title: 'ноутбук 1366×620', viewport: { width: 1366, height: 620 }, run: shortHero },
  { id: 'short-1280', title: 'ноутбук 1280×600', viewport: { width: 1280, height: 600 }, run: shortHero },
  { id: 'short-1366-no-js', title: 'ноутбук 1366×620 без JavaScript', viewport: { width: 1366, height: 620 }, javaScript: false, run: shortHero },
  { id: 'short-375', title: 'iPhone SE 375×553 (Safari)', viewport: { width: 375, height: 553 }, run: shortPhone },
  { id: 'short-375-reduce', title: 'iPhone SE 375×553, reduced motion', viewport: { width: 375, height: 553 }, reducedMotion: 'reduce', run: shortPhone },
  { id: 'short-390', title: 'iPhone 390×664 (панель Safari развёрнута)', viewport: { width: 390, height: 664 }, run: shortPhone },
  { id: 'landscape', title: 'телефон боком 844×340', viewport: { width: 844, height: 340 }, mobile: true, run: landscape },
  { id: 'reduced-phone', title: 'телефон 390: prefers-reduced-motion', viewport: PHONE, reducedMotion: 'reduce', run: reducedPhone },
  { id: 'ios-toolbar', title: 'iPhone 390×664: панель Safari сворачивается', viewport: { width: 390, height: 664 }, run: iosToolbar },
];

async function runCase(browser, baseUrl, c) {
  const results = [];
  const check = (label, ok, detail) => results.push({ label, ok: Boolean(ok), detail: ok ? '' : norm(detail) });
  if (c.fsOnly) {
    c.run({ check });
    return results;
  }
  const phone = c.mobile ?? c.viewport.width < 600;
  const context = await browser.newContext({
    viewport: c.viewport,
    deviceScaleFactor: 1,
    isMobile: phone,
    hasTouch: phone,
    locale: 'ru-RU',
    reducedMotion: c.reducedMotion ?? 'no-preference',
    colorScheme: c.colorScheme ?? 'light',
    javaScriptEnabled: c.javaScript !== false,
    extraHTTPHeaders: c.authed ? { 'x-test-auth': 'authed' } : {},
  });
  if (c.delayFonts) {
    await context.route('**/*.woff2', async (route) => {
      await new Promise((ok) => setTimeout(ok, c.delayFonts));
      await route.continue();
    });
  }
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  const external = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('request', (r) => {
    const url = r.url();
    if (!url.startsWith(baseUrl) && !url.startsWith('data:')) external.push(url);
  });
  let timer;
  try {
    await Promise.race([
      (async () => {
        await page.goto(`${baseUrl}${c.path ?? '/'}`, { waitUntil: 'load' });
        await settle(page);
        await c.run({ page, check, baseUrl, c });
      })(),
      new Promise((_, fail) => {
        timer = setTimeout(() => fail(new Error(`сценарий не уложился в ${CASE_TIMEOUT_MS / 1000} с`)), CASE_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    check('сценарий дошёл до конца', false, String(error.message).split('\n')[0]);
  } finally {
    clearTimeout(timer);
  }
  check('нет ошибок в консоли', errors.length === 0, errors.slice(0, 3).join(' | '));
  check('нет запросов на внешние адреса (шрифты и скрипты свои)', external.length === 0, external.slice(0, 3).join(' | '));
  await Promise.race([context.close().catch(() => {}), new Promise((ok) => setTimeout(ok, 10_000))]);
  return results;
}

async function main() {
  if (!existsSync(join(DIST, 'index.html'))) {
    console.error(red('Нет landing/dist/index.html — сначала npm run build:landing.'));
    process.exit(1);
  }
  const cases = CASES.filter((c) => !only.length || only.some((o) => c.id.includes(o)));
  const { browser, label, failures } = await launchBrowser();
  if (!browser) {
    const msg = `Браузер не найден:\n  ${failures.join('\n  ')}`;
    if (process.env.SMOKE_ALLOW_SKIP === '1') {
      console.warn(yellow(`${msg}\nSMOKE_ALLOW_SKIP=1 — смоук главной пропущен.`));
      process.exit(0);
    }
    console.error(red(msg));
    process.exit(1);
  }
  console.log(dim(`Браузер: ${label}`));
  const server = await startServer();
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  let failed = 0;
  let total = 0;
  for (const c of cases) {
    const results = await runCase(browser, baseUrl, c);
    const bad = results.filter((r) => !r.ok);
    total += results.length;
    failed += bad.length;
    console.log(`${bad.length ? red('✗') : green('✓')} ${c.id} — ${c.title}`);
    for (const r of results) {
      if (r.ok) console.log(dim(`    ✓ ${r.label}`));
      else console.log(`    ${red('✗')} ${r.label}${r.detail ? dim(`\n        ${r.detail}`) : ''}`);
    }
  }
  await browser.close();
  server.close();
  console.log(failed ? red(`\nУпало ${failed} из ${total} проверок.`) : green(`\nВсе ${total} проверок прошли.`));
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
