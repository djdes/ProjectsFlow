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
    return { header: zone('header.nav'), hero: zone('.hero__actions'), final: zone('.final'), plans: zone('#pricing .plans') };
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
// the screen unless an intentional clipper/scroller (the pin strip, the nav row, a section that
// clips its decoration) holds it.
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

// Text a person cannot read: transparent (with its ancestors) or blurred. Decorative parts, the
// illustration in the board window and answers of closed questions do not count.
async function hiddenText(page) {
  return page.evaluate(() => {
    const effective = (el) => {
      let o = 1;
      for (let a = el; a; a = a.parentElement) o *= parseFloat(getComputedStyle(a).opacity);
      return o;
    };
    return [...document.querySelectorAll('main h1, main h2, main h3, main p, main li, .statement__text .lw, main .w, main .rb, .foot a, .foot p')]
      .filter((el) => !el.closest('[aria-hidden="true"], .win, details:not([open]) .faq__a'))
      .filter((el) => effective(el) < 0.99 || getComputedStyle(el).filter !== 'none')
      .slice(0, 8)
      .map((el) => `${el.tagName.toLowerCase()} «${(el.textContent ?? '').trim().slice(0, 28)}» ${effective(el).toFixed(2)} ${getComputedStyle(el).filter}`);
  });
}

// Parts of the board window on the first screen that stick out of their card, column or panel.
// Text clipped on purpose (ellipsis in the LIVE list, crumbs) counts only where it is visible.
async function boardOverflow(page) {
  return page.evaluate(() => {
    const out = [];
    const shown = (el) => el.getBoundingClientRect().width > 0;
    const visibleSpan = (el, stop) => {
      let left = -Infinity;
      let right = Infinity;
      for (let a = el; a && a !== stop; a = a.parentElement) {
        if (getComputedStyle(a).overflowX === 'visible') continue;
        const r = a.getBoundingClientRect();
        left = Math.max(left, r.left);
        right = Math.min(right, r.right);
      }
      return [left, right];
    };
    const within = (box, el, label) => {
      const b = box.getBoundingClientRect();
      const [clipL, clipR] = visibleSpan(el, box);
      const range = document.createRange();
      range.selectNodeContents(el);
      for (const r of [el.getBoundingClientRect(), ...range.getClientRects()]) {
        const left = Math.max(r.left, clipL);
        const right = Math.min(r.right, clipR);
        if (!r.width || right <= left) continue;
        if (left < b.left - 0.5 || right > b.right + 0.5) {
          out.push(`${label} «${(el.textContent ?? '').trim().slice(0, 18)}» ${Math.round(left - b.left)}…${Math.round(right - b.right)}`);
          return;
        }
      }
    };
    const win = document.querySelector('.hero .win');
    const cols = [...win.querySelectorAll('.col')];
    for (const card of win.querySelectorAll('.card')) {
      within(card.classList.contains('c2') ? cols[1] : cols[0], card, 'карточка шире колонки');
      for (const el of card.querySelectorAll('*')) within(card, el, 'вылезает из карточки');
    }
    win.querySelectorAll('.colh').forEach((head, i) => {
      within(cols[i], head, 'заголовок шире колонки');
      for (const el of head.querySelectorAll('*')) within(cols[i], el, 'заголовок шире колонки');
    });
    const live = win.querySelector('.live');
    if (shown(live)) for (const el of live.querySelectorAll('*')) within(live, el, 'вылезает из LIVE');
    const bar = win.querySelector('.win__bar');
    for (const el of bar.children) if (shown(el)) within(bar, el, 'вылезает из шапки окна');
    return [...new Set(out)].slice(0, 8);
  });
}

// The first screen: lines of the title (layout positions, immune to the reveal transforms) and
// where the facts band ends.
async function heroReport(page) {
  return page.evaluate(() => {
    const tops = [...document.querySelectorAll('.hero__title .w')].map((w) => w.offsetTop + w.offsetParent.getBoundingClientRect().top);
    const lines = tops.sort((a, b) => a - b).filter((t, i, a) => i === 0 || t - a[i - 1] > 4).length;
    return {
      lines,
      font: getComputedStyle(document.querySelector('.hero__title')).fontSize,
      statsBottom: Math.round(document.querySelector('.hero .stats').getBoundingClientRect().bottom),
      vh: window.innerHeight,
    };
  });
}

// Gap between «Открыть» and «приложение» in the header button of a signed-in person (null where the
// short label is shown).
async function ctaGap(page) {
  return page.evaluate(() => {
    const cta = [...document.querySelectorAll('header .nav__cta')].find((a) => a.getBoundingClientRect().width > 0);
    const more = cta?.querySelector('.nav__more');
    if (!cta || !more || !more.getBoundingClientRect().width) return null;
    const first = document.createRange();
    first.selectNodeContents(cta.firstChild);
    const text = more.firstChild;
    const word = document.createRange();
    word.setStart(text, text.data.search(/\S/));
    word.setEnd(text, text.data.length);
    return Math.round((word.getBoundingClientRect().left - first.getBoundingClientRect().right) * 10) / 10;
  });
}

// Accessible names of the elements matched by `selector` as Chrome hands them to screen readers
// (its accessibility tree over CDP). Playwright's getByRole works names out of the DOM text itself
// and does not see text-transform, so it cannot tell «Прайм» from «ПРАЙМ».
async function axNames(page, selector) {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector });
    const names = [];
    for (const nodeId of nodeIds) {
      const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
      names.push(nodes[0]?.name?.value ?? '');
    }
    return names;
  } finally {
    await cdp.detach().catch(() => {});
  }
}

// Contrast ratio (WCAG) of each element's text colour laid over the black page: the browser resolves
// the colour (OKLCH with alpha), a 1×1 canvas blends it over black.
async function contrastOnBlack(page, selectors) {
  return page.evaluate((list) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const channel = (v) => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return Object.fromEntries(
      list.map((sel) => {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, 1, 1);
        ctx.fillStyle = getComputedStyle(document.querySelector(sel)).color;
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        const lum = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
        return [sel, Math.round(((lum + 0.05) / 0.05) * 100) / 100];
      }),
    );
  }, selectors);
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
        badge: text(p.querySelector('.badge')),
        // Layout positions: the cards may still be emerging (staggered translateY), so the row is
        // read from offsetTop and a button from its offset inside its own card.
        top: p.offsetTop,
        ctaTop: Math.round(([...p.querySelectorAll('.plan__cta .btn')].find((b) => b.getBoundingClientRect().height > 0)?.getBoundingClientRect().top ?? NaN) - p.getBoundingClientRect().top),
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
  check('у «Прайма» бейдж «Популярный» и пробный час', info.plans[1]?.badge === 'Популярный' && info.plans[1]?.trial === 'Попробовать 1 час бесплатно', JSON.stringify(info.plans[1]));
  const card = await page.evaluate(() => {
    const plans = document.querySelector('#pricing .plans');
    const line = plans ? getComputedStyle(plans, '::before') : null;
    return { line: line ? line.backgroundImage : '', edges: plans ? plans.querySelectorAll('.edge').length : -1 };
  });
  check('кнопки трёх тарифов на одной высоте', new Set(info.plans.map((p) => p.ctaTop)).size === 1, info.plans.map((p) => p.ctaTop).join(','));
  check('тарифы одной карточкой: три колонки в ряд, радужная линия сверху, без крутящейся обводки', info.plans.length === 3 && new Set(info.plans.map((p) => p.top)).size === 1 && card.line.includes('linear-gradient') && card.edges === 0, JSON.stringify({ tops: info.plans.map((p) => p.top), ...card }));
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
  const axPlans = await axNames(page, '#pricing .plan__name');
  check('тарифы: названия в дереве доступности как в тексте, не капсом (Бесплатный, Прайм, VIP)', axPlans.length === 3 && axPlans.join('|') === info.plans.map((p) => p.name).join('|'), axPlans.join('|'));
  const contrast = await contrastOnBlack(page, ['.hero__note', '.stage__cap', '.hero__lead']);
  check('мелкий серый текст (примечание под кнопками, подпись под окном доски): контраст ≥ 4.5:1, тусклее подзаголовка', ['.hero__note', '.stage__cap'].every((s) => contrast[s] >= 4.5 && contrast[s] < contrast['.hero__lead']), JSON.stringify(contrast));
  const footContrast = await contrastOnBlack(page, ['.foot__h', '.foot__bottom']);
  check('подвал: мелкий серый текст (заголовки колонок, нижняя строка) — контраст ≥ 4.5:1', Object.values(footContrast).every((v) => v >= 4.5), JSON.stringify(footContrast));
  const misc = await page.evaluate(() => ({
    stepTops: [...document.querySelectorAll('.steps > .step')].map((el) => ({ i: el.style.getPropertyValue('--i'), top: getComputedStyle(el).insetBlockStart })),
    drawnCursor: getComputedStyle(document.querySelector('.approve .btn')).cursor,
  }));
  check('отступы шагов стопкой из --i (112px + i × 22px)', misc.stepTops.length === 4 && misc.stepTops.every((s, i) => s.i.trim() === String(i) && s.top === `${112 + i * 22}px`), JSON.stringify(misc.stepTops));
  check('у нарисованной кнопки в шагах нет курсора-руки', misc.drawnCursor !== 'pointer', misc.drawnCursor);
  let focused = '';
  for (let n = 0; n < 20; n += 1) {
    await page.keyboard.press('Tab');
    focused = await page.evaluate(() => (document.activeElement?.matches('.hero__actions a.btn') ? getComputedStyle(document.activeElement).borderTopLeftRadius : ''));
    if (focused) break;
  }
  check('рамка фокуса с клавиатуры не меняет форму кнопки-пилюли', focused === '999px', focused || 'кнопка не получила фокус');
  const scheme = await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);
  check('светлая тема ОС: у чёрной страницы тёмные полосы прокрутки (color-scheme: dark)', scheme === 'dark', scheme);
}

async function desktopMotion({ page, check }) {
  const headWords = await page.evaluate(() => document.querySelectorAll('#features .h2 .w').length);
  check('заголовки размечены по словам (.w)', headWords >= 3, String(headWords));

  // Every block that emerges (.rb) transitions opacity, filter and transform. A button that emerges
  // (.btn.rb: the CTA in the steps) brings its own transition, which used to win the cascade, so the
  // button popped in while the text next to it emerged.
  const reveal = await page.evaluate(() => {
    const list = (v) => v.split(',').map((s) => s.trim());
    const timing = (el, prop) => {
      const s = getComputedStyle(el);
      const i = list(s.transitionProperty).indexOf(prop);
      return i < 0 ? null : { duration: list(s.transitionDuration)[i], delay: list(s.transitionDelay)[i] };
    };
    const cta = document.querySelector('.how__sticky a.btn.rb');
    return {
      missing: [...document.querySelectorAll('.rb')]
        .filter((el) => !['opacity', 'filter', 'transform'].every((p) => timing(el, p)))
        .map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`),
      cta: { background: timing(cta, 'background-color'), opacity: timing(cta, 'opacity'), d: cta.style.getPropertyValue('--d') },
      text: timing(document.querySelector('.how__sticky .sub.rb'), 'opacity'),
    };
  });
  check('проявление: у каждого блока .rb переходы opacity, filter и transform (кнопка в шагах тоже)', reveal.missing.length === 0, reveal.missing.join(', '));
  check(
    'кнопка в шагах: свой переход фона на месте, проявляется как текст рядом, с задержкой --d',
    Boolean(reveal.cta.background && reveal.cta.opacity && reveal.text) && reveal.cta.opacity.duration === reveal.text.duration && Math.round(parseFloat(reveal.cta.opacity.delay) * 1000) === parseFloat(reveal.cta.d),
    JSON.stringify(reveal),
  );

  // Words of the titles below the fold wait in their hidden state; the shift they emerge from stays
  // within 16px (DESIGN.md), the 72px final title included. Running transitions are finished first.
  const shift = await page.evaluate(() =>
    [...document.querySelectorAll('.rw:not(.is-in) .w')].reduce(
      (most, w) => {
        for (const a of w.getAnimations()) {
          try {
            a.finish();
          } catch {
            /* an endless animation cannot finish: not the case for words */
          }
        }
        const y = new DOMMatrix(getComputedStyle(w).transform).m42;
        return y > most.y ? { y: Math.round(y * 100) / 100, title: w.closest('.rw').id, font: getComputedStyle(w).fontSize } : most;
      },
      { y: 0 },
    ),
  );
  check('слова заголовков выходят из размытия со сдвигом не больше 16px (крупный финальный заголовок тоже)', shift.y > 0 && shift.y <= 16, JSON.stringify(shift));

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
  await scrollToY(page, pin.top + pin.height - DESKTOP.height);
  const lastRight = await page.evaluate(() => {
    const cards = document.querySelectorAll('.pin__track .fc');
    return Math.round(cards[cards.length - 1].getBoundingClientRect().right);
  });
  check('в конце «Мелочей» последняя карточка не встаёт вплотную к краю', lastRight <= DESKTOP.width - 40, `${lastRight} из ${DESKTOP.width}`);

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
  const planTexts = texts(z.plans);
  check('вошедший: в тарифах «Открыть приложение» вместо регистрации', planTexts.filter((t) => t === 'Открыть приложение').length === 3 && !planTexts.some((t) => ['Начать бесплатно', 'Перейти на Прайм', 'Оставить заявку', 'Попробовать 1 час бесплатно'].includes(t)), planTexts.join(' | '));
  for (const [zone, label] of [['header', 'в шапке'], ['hero', 'на первом экране'], ['final', 'в финале']]) {
    const t = texts(z[zone]);
    check(`вошедший: ${label} «Открыть приложение» вместо «Войти» / «Начать бесплатно»`, Boolean(appLink(z[zone])) && /\/$/.test(appLink(z[zone])?.href ?? '') && !t.includes('Войти') && !t.includes('Начать бесплатно'), t.join(' | '));
  }
  const gap = await ctaGap(page);
  check('вошедший: в кнопке шапки «Открыть приложение» слова не слиплись', gap === null || gap >= 2, `${gap}px`);
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
  const stat = await page.evaluate(() => ({ bar: getComputedStyle(document.querySelector('.pin__foot')).display, tab: document.querySelector('.pin__track').getAttribute('tabindex') }));
  check('reduce: нет пустой полоски прогресса, ленту можно листать с клавиатуры', stat.bar === 'none' && stat.tab === '0', JSON.stringify(stat));
  await scrollToY(page, 600);
  const hero = await page.evaluate(() => getComputedStyle(document.querySelector('.hero__in')).opacity);
  check('reduce: первый экран не гаснет при прокрутке', hero === '1', hero);
}

async function noScript({ page, check }) {
  const root = await page.evaluate(() => document.querySelector('.pf')?.className ?? '');
  check('без JS: классов движения нет', root.includes('pf') && !root.includes('pf--motion') && !root.includes('pf--static'), root);
  // The CSS-only intro of the first screen (blur → sharp) lasts about two seconds.
  await page.waitForTimeout(2300);
  const hidden = await hiddenText(page);
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
  const stat = await page.evaluate(() => ({ bar: getComputedStyle(document.querySelector('.pin__foot')).display, tab: document.querySelector('.pin__track').getAttribute('tabindex') }));
  check('без JS: нет пустой полоски прогресса, ленту можно листать с клавиатуры', stat.bar === 'none' && stat.tab === '0', JSON.stringify(stat));
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
  const planTops = await page.evaluate(() => [...document.querySelectorAll('#pricing .plan')].map((p) => Math.round(p.getBoundingClientRect().top)));
  check('390: тарифы друг под другом', planTops.length === 3 && planTops[1] > planTops[0] && planTops[2] > planTops[1], planTops.join(','));
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
  // Not pinned, the strip has nothing to report progress of: no bar (it stood full), a thin scrollbar.
  const bar = await page.evaluate(() => ({
    progress: getComputedStyle(document.querySelector('.pin__foot')).display,
    scrollbar: getComputedStyle(document.querySelector('.pin__track')).scrollbarWidth,
  }));
  check(`${sizeLabel(c)}: у ленты «Мелочей» тонкая полоса прокрутки, полоски прогресса нет`, bar.progress === 'none' && bar.scrollbar === 'thin', JSON.stringify(bar));
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

// Keyboard focus may land on a block that has not emerged yet: a question at the very bottom of the
// screen is below the reveal line. It must show up at once, with its focus ring.
async function focusReveal({ page, check }) {
  await page.evaluate(() => document.fonts.ready);
  const last = await page.evaluate(() => document.querySelectorAll('details.faq__item').length - 1);
  await page.evaluate((i) => {
    const el = document.querySelectorAll('details.faq__item')[i];
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.95, behavior: 'instant' });
  }, last);
  await settle(page);
  await page.waitForTimeout(500);
  const hiddenBefore = await page.evaluate((i) => !document.querySelectorAll('details.faq__item')[i].classList.contains('is-in'), last);
  await page.evaluate((i) => document.querySelectorAll('details.faq__item')[i].querySelector('summary').focus({ preventScroll: true }), last);
  await page
    .waitForFunction((i) => {
      const s = getComputedStyle(document.querySelectorAll('details.faq__item')[i]);
      return s.opacity === '1' && s.filter === 'none';
    }, last, { timeout: 3000, polling: 100 })
    .catch(() => {});
  const after = await page.evaluate((i) => {
    const el = document.querySelectorAll('details.faq__item')[i];
    return { opacity: getComputedStyle(el).opacity, filter: getComputedStyle(el).filter, focused: document.activeElement === el.querySelector('summary') };
  }, last);
  check('фокус с клавиатуры на вопросе у нижнего края (ещё не проявился): вопрос и рамка фокуса видны', hiddenBefore && after.focused && after.opacity === '1' && after.filter === 'none', JSON.stringify({ hiddenBefore, ...after }));
}

// Print and «Save as PDF» get what the screen shows without motion: nothing transparent or blurred,
// the fan open, and the scroll scenes (first screen, steps, strip, footer) in their resting place.
async function printPage({ page, check }) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(2300);
  await page.emulateMedia({ media: 'print' });
  await settle(page);
  let hidden = await hiddenText(page);
  check('печать с начала страницы: весь текст виден', hidden.length === 0, hidden.join('; '));
  const angle = await page.evaluate(() => {
    const m = new DOMMatrix(getComputedStyle([...document.querySelectorAll('#platforms .pcard')].at(-1)).transform);
    return Math.round((Math.atan2(m.b, m.a) * 180) / Math.PI);
  });
  check('печать: веер платформ раскрыт', angle >= 20, `${angle}°`);
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => document.getElementById('pricing').scrollIntoView({ block: 'start', behavior: 'instant' }));
  await settle(page);
  await page.waitForTimeout(200);
  await page.emulateMedia({ media: 'print' });
  await settle(page);
  hidden = await hiddenText(page);
  check('печать из середины страницы: первый экран и подвал не погашены прокруткой', hidden.length === 0, hidden.join('; '));
  const scenes = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    return {
      steps: [...document.querySelectorAll('.step')].map((s) => getComputedStyle(s, '::after').opacity).filter((o) => o !== '0').length,
      track: getComputedStyle(document.querySelector('.pin__track')).transform,
      outside: [...document.querySelectorAll('.pin__track .fc')].filter((c) => {
        const r = c.getBoundingClientRect();
        return r.left < -0.5 || r.right > vw + 0.5;
      }).length,
    };
  });
  check('печать из середины страницы: шаги не затемнены, все карточки «Мелочей» на странице', scenes.steps === 0 && scenes.track === 'none' && scenes.outside === 0, JSON.stringify(scenes));
  // Sticky and fixed blocks print where they stand in the page, not where the scroll left them.
  const layout = await page.evaluate(() => {
    const box = (sel) => document.querySelector(sel).getBoundingClientRect();
    const steps = [...document.querySelectorAll('.step')].map((s) => s.getBoundingClientRect());
    return {
      header: Math.round(box('header.nav').top + window.scrollY),
      heroOverSheet: Math.round(box('.hero').bottom - box('.statement').top),
      stepsOverlap: steps.slice(1).filter((r, i) => r.top < steps[i].bottom - 1).length,
      footOverMain: Math.round(box('main').bottom - box('.foot').top),
    };
  });
  check('печать из середины страницы: шапка один раз сверху, первый экран, шаги и подвал не наезжают друг на друга', layout.header <= 1 && layout.heroOverSheet <= 1 && layout.stepsOverlap === 0 && layout.footOverMain <= 1, JSON.stringify(layout));
}

// The board window of the first screen at each size of the case: nothing sticks out.
async function boardSizes({ page, check, c }) {
  for (const [width, height] of c.sizes) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => document.fonts.ready);
    await settle(page);
    const bad = await boardOverflow(page);
    check(`${width}×${height}: окно доски — всё внутри карточек, колонок и ленты`, bad.length === 0, bad.join(' | '));
  }
}

// «Где работает» between the phone deck and laptops (601–790px): the open fan keeps clear of the
// screen edges, its notes are readable, and no card hides the title or note of the card under it.
async function fanSizes({ page, check, c }) {
  for (const [width, height] of c.sizes) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => document.querySelector('#platforms .fan').scrollIntoView({ block: 'center', behavior: 'instant' }));
    await settle(page);
    const r = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const cards = [...document.querySelectorAll('#platforms .pcard')];
      // Letters whose centre (their box turns with the card) lies under another card.
      const covered = (el) => {
        const own = el.closest('.pcard');
        const out = [];
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let text = walker.nextNode(); text; text = walker.nextNode()) {
          for (let i = 0; i < text.data.length; i += 1) {
            if (/\s/.test(text.data[i])) continue;
            const range = document.createRange();
            range.setStart(text, i);
            range.setEnd(text, i + 1);
            const b = range.getBoundingClientRect();
            const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)?.closest('.pcard');
            if (top && top !== own) out.push(text.data[i]);
          }
        }
        return out.join('');
      };
      return {
        vw,
        edges: cards.map((card) => {
          const b = card.getBoundingClientRect();
          return `${Math.round(b.left)}…${Math.round(b.right)}`;
        }),
        outside: cards.filter((card) => {
          const b = card.getBoundingClientRect();
          return b.left < 8 || b.right > vw - 8;
        }).length,
        notes: [...new Set(cards.map((card) => getComputedStyle(card.querySelector('.pcard__n')).fontSize))],
        covered: cards
          .map((card) => [covered(card.querySelector('.pcard__t')), covered(card.querySelector('.pcard__n'))].filter(Boolean).join(' '))
          .filter(Boolean),
      };
    });
    check(`${width}×${height}: веер «Где работает» не ближе 8px к краям экрана`, r.outside === 0, `${r.vw}px: ${r.edges.join(', ')}`);
    check(`${width}×${height}: подписи карточек веера не мельче 12px`, r.notes.every((f) => parseFloat(f) >= 12), r.notes.join(', '));
    check(`${width}×${height}: названия и подписи карточек веера не закрыты соседней карточкой`, r.covered.length === 0, r.covered.join(' | '));
  }
}

// Laptop and desktop windows: the title takes at most three lines and the facts band is on the first screen.
const HERO_SIZES = [[1440, 790], [1536, 740], [1366, 768], [1280, 800], [1680, 950], [1920, 950], [1920, 1080], [2560, 1300], [1440, 900]];

async function heroSizes({ page, check }) {
  for (const [width, height] of HERO_SIZES) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => document.fonts.ready);
    await scrollToY(page, 0);
    const r = await heroReport(page);
    check(`${width}×${height}: заголовок первого экрана не длиннее трёх строк`, r.lines <= 3, JSON.stringify(r));
    check(`${width}×${height}: полоса фактов целиком на первом экране`, r.statsBottom <= height, JSON.stringify(r));
  }
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
  { id: 'focus-reveal', title: 'ПК 1440: фокус с клавиатуры на ещё скрытом блоке', viewport: DESKTOP, run: focusReveal },
  { id: 'print', title: 'ПК 1440: печать и «Сохранить как PDF»', viewport: DESKTOP, run: printPage },
  { id: 'board-desktop', title: 'окно доски: планшет боком, ноутбуки, ПК', viewport: { width: 1024, height: 768 }, reducedMotion: 'reduce', sizes: [[1024, 768], [1180, 820], [1280, 800], [1366, 768], [1440, 900], [1920, 1080]], run: boardSizes },
  { id: 'board-phone', title: 'окно доски: узкие телефоны', viewport: NARROW, reducedMotion: 'reduce', sizes: [[320, 640], [360, 740], [390, 844]], run: boardSizes },
  { id: 'fan-tablet', title: 'веер «Где работает» на 601–1280px (планшеты, телефоны боком, ноутбуки)', viewport: { width: 700, height: 900 }, reducedMotion: 'reduce', sizes: [[601, 900], [700, 900], [768, 1024], [790, 900], [791, 900], [834, 1112], [900, 900], [1000, 800], [1024, 768], [1280, 800]], run: fanSizes },
  { id: 'hero-sizes', title: 'первый экран в окнах ноутбуков и ПК', viewport: { width: 1440, height: 790 }, run: heroSizes },
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
