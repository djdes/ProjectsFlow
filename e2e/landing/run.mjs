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
import { extname, join, resolve, sep } from 'node:path';
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
      facts: document.querySelectorAll('.fact').length,
      steps: document.querySelectorAll('.step').length,
      details: document.querySelectorAll('.pin__track .fc').length,
      guarantees: document.querySelectorAll('.guar li').length,
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
  check('фраза из 22 слов, 4 факта, 4 шага, 8 мелочей, 4 гарантии', info.words === 22 && info.facts === 4 && info.steps === 4 && info.details === 8 && info.guarantees === 4, JSON.stringify(info));
  check('в подвале 3 свежие статьи', info.posts === 3, String(info.posts));
  check('шрифт Inter Variable загружен', info.font);
}

async function desktopMotion({ page, check }) {
  const root = await page.evaluate(() => document.querySelector('.pf')?.className ?? '');
  check('Chromium: текст проявляет CSS (animation-timeline), без .pf--tjs', root.includes('pf--motion') && !root.includes('pf--tjs'), root);

  await scrollToY(page, 0);
  const h0 = await cssNumber(page, '.hero', '--h');
  await scrollToY(page, DESKTOP.height * 0.85 + 10);
  const h1 = await cssNumber(page, '.hero', '--h');
  check('первый экран: --h от 0 до 1 за 85% высоты', h0 === 0 && h1 >= 0.99, `${h0} → ${h1}`);

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
  const before = await page.evaluate(() => {
    const s = getComputedStyle(document.querySelector('#faq .h2'));
    return { opacity: parseFloat(s.opacity), filter: s.filter };
  });
  await page.evaluate(() => document.querySelector('#faq .h2').scrollIntoView({ block: 'center', behavior: 'instant' }));
  await settle(page);
  await page.waitForTimeout(80);
  const after = await page.evaluate(() => {
    const s = getComputedStyle(document.querySelector('#faq .h2'));
    return { opacity: parseFloat(s.opacity), filter: s.filter };
  });
  check('текст раздела проступает из размытия при въезде в экран', before.opacity < 0.6 && before.filter.includes('blur') && after.opacity > 0.99 && /none|blur\(0px\)/.test(after.filter), `${JSON.stringify(before)} → ${JSON.stringify(after)}`);

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
    return [...document.querySelectorAll('main h1, main h2, main h3, main p, main li, .statement__text .lw')]
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
}

async function anchors({ page, check, baseUrl }) {
  for (const id of ['pricing', 'faq']) {
    await page.goto(`${baseUrl}/#${id}`, { waitUntil: 'load' });
    await waitScrollStable(page);
    const r = await page.evaluate((sel) => ({
      y: window.scrollY,
      header: document.querySelector('header.nav').getBoundingClientRect().bottom,
      h2: document.querySelector(`#${sel} .h2`).getBoundingClientRect().top,
    }), id);
    check(`/#${id}: заголовок раздела не под фиксированной шапкой`, r.y > 0 && r.h2 >= r.header - 1, JSON.stringify(r));
  }
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
];

async function runCase(browser, baseUrl, c) {
  const results = [];
  const check = (label, ok, detail) => results.push({ label, ok: Boolean(ok), detail: ok ? '' : norm(detail) });
  if (c.fsOnly) {
    c.run({ check });
    return results;
  }
  const phone = c.viewport.width < 600;
  const context = await browser.newContext({
    viewport: c.viewport,
    deviceScaleFactor: 1,
    isMobile: phone,
    hasTouch: phone,
    locale: 'ru-RU',
    reducedMotion: c.reducedMotion ?? 'no-preference',
    javaScriptEnabled: c.javaScript !== false,
    extraHTTPHeaders: c.authed ? { 'x-test-auth': 'authed' } : {},
  });
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
        await page.goto(`${baseUrl}/`, { waitUntil: 'load' });
        await settle(page);
        await c.run({ page, check, baseUrl });
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
