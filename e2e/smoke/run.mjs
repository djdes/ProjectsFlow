#!/usr/bin/env node
// Smoke tests of the ProjectsFlow client. How to run and extend: e2e/smoke/README.md.
//
//   node e2e/smoke/run.mjs                 # client/dist on a built-in static server
//   node e2e/smoke/run.mjs --url <address> # an already running client (dev server, preview)
//   node e2e/smoke/run.mjs --only inbox    # only cases whose id/title contains «inbox»
//
// Env: SMOKE_URL (same as --url), SMOKE_ONLY (same as --only), CHROME_PATH (browser binary),
// SMOKE_ALLOW_SKIP=1 (no browser found → warning and exit 0 instead of exit 1).

import { createServer } from 'node:http';
import { createReadStream, existsSync, readdirSync } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createApiRouter } from './fixtures.mjs';
import { THEMES, VIEWPORTS, scenarios } from './scenarios.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const DIST = join(ROOT, 'client', 'dist');
const ARTIFACTS = join(HERE, '.artifacts');

const CASE_TIMEOUT_MS = 60_000;
const ACTION_TIMEOUT_MS = 8_000;
const READY_TIMEOUT_MS = 15_000;
// This many cases in a row whose first page did not load → the app is down, stop the run.
const LOAD_FAILURES_TO_STOP = 4;
const NAVIGATION_TIMEOUT_MS = 20_000;
const CONSOLE_TAIL = 60;
// Texts of the app's crash screens: React Router's default error element, the root
// ErrorBoundary and PageLoadError.
const ERROR_SCREEN_MARKERS = ['Unexpected Application Error!', 'Что-то пошло не так', 'Не удалось загрузить страницу'];

// ---------------------------------------------------------------- CLI ----

function parseArgs(argv) {
  const opts = {
    url: process.env.SMOKE_URL || null,
    only: process.env.SMOKE_ONLY || null,
    headed: false,
    list: false,
    verbose: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const [key, inline] = arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, null];
    const value = () => inline ?? argv[++i];
    if (key === '--url') opts.url = value();
    else if (key === '--only') opts.only = value();
    else if (key === '--headed') opts.headed = true;
    else if (key === '--list') opts.list = true;
    else if (key === '--verbose' || key === '-v') opts.verbose = true;
    else if (key === '--help' || key === '-h') {
      console.log(
        [
          'Смоук-тесты клиента ProjectsFlow.',
          '',
          '  node e2e/smoke/run.mjs              собранный client/dist на встроенном сервере',
          '  node e2e/smoke/run.mjs --url <адрес>  уже запущенный клиент (например, Vite dev)',
          '  --only <часть id/названия>[,…]     только подходящие сценарии',
          '  --list                             показать сценарии и выйти',
          '  --headed                           показать окно браузера',
          '  --verbose                          печатать все проверки, а не только упавшие',
          '',
          'Переменные: SMOKE_URL, SMOKE_ONLY, CHROME_PATH, SMOKE_ALLOW_SKIP=1.',
        ].join('\n'),
      );
      process.exit(0);
    } else {
      console.error(`Неизвестный аргумент: ${arg} (см. --help)`);
      process.exit(2);
    }
  }
  return opts;
}

// --------------------------------------------------------- output style ----

const useColor = !process.env.NO_COLOR && (process.stdout.isTTY || Boolean(process.env.CI));
const paint = (code) => (text) => (useColor ? `\u001b[${code}m${text}\u001b[0m` : String(text));
const green = paint('32');
const red = paint('31');
const yellow = paint('33');
const dim = paint('2');
const bold = paint('1');

const MARK = {
  pass: green('✓'),
  fail: red('✗'),
  expected: yellow('○'),
  skip: dim('–'),
};

const seconds = (ms) => `${(ms / 1000).toFixed(1)} с`;
// Russian plural: plural(3, 'проверка', 'проверки', 'проверок') → «3 проверки».
function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word = mod10 === 1 && mod100 !== 11 ? one : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? few : many;
  return `${n} ${word}`;
}
const checksWord = (n) => plural(n, 'проверка', 'проверки', 'проверок');
const casesWord = (n) => plural(n, 'сценарий', 'сценария', 'сценариев');
const firstLine = (text) => String(text ?? '').split('\n').find((l) => l.trim()) ?? '';
// Playwright errors carry ANSI colours and blank lines in their «Call log».
const cleanError = (text) =>
  String(text ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b\[[0-9;]*m/g, '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .join('\n');

// ------------------------------------------------------ static server ----

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

async function fileStat(path) {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}

// Serves `root` with an SPA fallback to index.html. /api never reaches it in a healthy run
// (the browser answers /api itself); a leak is counted and answered with 503.
function startStaticServer(root) {
  const leaks = [];
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const pathname = decodeURIComponent(url.pathname);
      if (pathname === '/api' || pathname.startsWith('/api/')) {
        leaks.push(`${req.method} ${pathname}`);
        res.writeHead(503, { 'content-type': 'application/json; charset=utf-8' });
        res.end('{"error":"smoke_no_backend"}');
        return;
      }
      let target = resolve(root, `.${pathname}`);
      if (target !== root && !target.startsWith(root + sep)) {
        res.writeHead(403).end();
        return;
      }
      let info = await fileStat(target);
      if (info?.isDirectory()) {
        target = join(target, 'index.html');
        info = await fileStat(target);
      }
      if (!info) {
        const ext = extname(pathname);
        const wantsHtml = String(req.headers.accept ?? '').includes('text/html');
        if (ext && ext !== '.html' && !wantsHtml) {
          res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
          return;
        }
        target = join(root, 'index.html');
        info = await fileStat(target);
      }
      res.writeHead(200, {
        'content-type': MIME[extname(target).toLowerCase()] ?? 'application/octet-stream',
        'content-length': info.size,
        'cache-control': 'no-store',
      });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      createReadStream(target).pipe(res);
    } catch (error) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end(String(error));
    }
  });
  return new Promise((resolveServer, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolveServer({ server, url: `http://127.0.0.1:${port}`, leaks });
    });
  });
}

// ------------------------------------------------------------ browser ----

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
    darwin: [
      ['chrome-mac-arm64', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'],
      ['chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'],
    ],
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

async function launchBrowser({ headed }) {
  const base = { headless: !headed };
  const attempts = [];
  if (process.env.CHROME_PATH) {
    attempts.push({ label: `CHROME_PATH (${process.env.CHROME_PATH})`, options: { ...base, executablePath: process.env.CHROME_PATH } });
  }
  attempts.push({ label: 'Google Chrome', options: { ...base, channel: 'chrome' } });
  attempts.push({ label: 'Microsoft Edge', options: { ...base, channel: 'msedge' } });
  for (const exe of cachedChromiumExecutables()) {
    attempts.push({ label: `Chromium из кэша Playwright (${exe})`, options: { ...base, executablePath: exe } });
  }
  const failures = [];
  for (const attempt of attempts) {
    try {
      const browser = await chromium.launch(attempt.options);
      return { browser, label: `${attempt.label} ${browser.version()}`, failures };
    } catch (error) {
      failures.push(`${attempt.label}: ${firstLine(cleanError(error.message))}`);
    }
  }
  return { browser: null, label: null, failures };
}

// -------------------------------------------------------- case runtime ----

class AbortCase extends Error {}

// Console errors that are artefacts of the sandbox, not of the app. Judged by the message
// text and, for network errors («Failed to load resource»), by the failed resource URL.
// Note: the Vite dev client wraps console.*, so in dev every message «comes» from
// /@vite/client — the location alone says nothing.
function allowedConsoleError(entry, run) {
  const { text, url } = entry;
  const networkError = /^Failed to load resource/.test(text);
  if ((networkError && /\/stream(\/|\?|$)/.test(url)) || /EventSource/.test(text)) {
    return 'стрим (SSE) оборван смоуком';
  }
  if (/^\[vite\]/.test(text) || /WebSocket connection to '.*' failed/.test(text)) return 'HMR дев-сервера Vite';
  if (networkError && run.blockedUrls.has(url)) return 'внешний запрос заблокирован смоуком';
  if (networkError && run.journal.expectedErrors?.some((e) => e.url === url && text.includes(String(e.status)))) {
    return 'ошибка сети, явно заданная сценарием для проверки восстановления';
  }
  if (!run.authenticated && /\/api\/auth\/me(\?|$)/.test(url) && /\b401\b/.test(text)) {
    return 'проверка сессии без входа (401 — ожидаемо)';
  }
  return null;
}

// Runs in the page. Without a selector it checks the page: the document and [data-pf-main]
// must not be wider than the screen. html/body clip horizontal overflow (overflow-x: clip),
// so a too-wide element is cut off instead of scrolling and scrollWidth does not show it —
// hence the page is also scanned for elements that stick out of the viewport. With a
// selector (a dialog, a sheet) it checks that box: inside the viewport, content not wider
// than the box. Offenders are the outermost elements that stick out, not clipped by an inner
// scroll/clip container that itself fits — so a failure says what to fix.
function measureOverflow(scopeSelector) {
  const doc = document.documentElement;
  const vw = doc.clientWidth;
  const result = { viewport: vw, doc: 0, main: null, box: 0, inner: 0, missing: false, offenders: [] };

  const describe = (el) => {
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 4).join('.') : '';
    const attrs = [...el.attributes]
      .filter((a) => a.name.startsWith('data-pf') || a.name === 'aria-label' || a.name === 'role')
      .map((a) => `[${a.name}${a.value ? `="${a.value.slice(0, 40)}"` : ''}]`)
      .join('');
    const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 50);
    return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls ? `.${cls}` : ''}${attrs}${text ? ` «${text}»` : ''}`;
  };
  const found = [];
  const scan = (scope, left, right) => {
    const sticksOut = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      return r.right > right + 1 || r.left < left - 1;
    };
    const isOffender = (el) => {
      if (!sticksOut(el)) return false;
      for (let a = el; a && a !== scope; a = a.parentElement) {
        const style = getComputedStyle(a);
        if (style.position === 'fixed' || style.display === 'contents') return false;
        if (a !== el && style.overflowX !== 'visible') {
          const ar = a.getBoundingClientRect();
          if (ar.right <= right + 1 && ar.left >= left - 1) return false;
        }
      }
      return true;
    };
    for (const el of scope.querySelectorAll('*')) {
      if (found.length >= 5) break;
      if (found.includes(el) || !isOffender(el)) continue;
      if (el.parentElement && el.parentElement !== scope && isOffender(el.parentElement)) continue;
      found.push(el);
      const r = el.getBoundingClientRect();
      const edge = r.right > right + 1 ? `правый край ${Math.round(r.right)}px` : `левый край ${Math.round(r.left)}px`;
      result.offenders.push(`${describe(el)} → ${edge}`);
    }
  };

  if (scopeSelector) {
    const box = document.querySelector(scopeSelector);
    if (!box) {
      result.missing = true;
      return result;
    }
    const r = box.getBoundingClientRect();
    result.box = Math.round(Math.max(r.right - vw, -r.left, 0));
    result.inner = box.scrollWidth - box.clientWidth;
    if (result.box > 1 || result.inner > 1) scan(box, Math.max(r.left, 0), Math.min(r.right, vw));
  } else {
    const main = document.querySelector('[data-pf-main]');
    result.doc = doc.scrollWidth - vw;
    result.main = main ? main.scrollWidth - main.clientWidth : null;
    scan(document.body, 0, vw);
    if (main && result.main > 1) {
      const r = main.getBoundingClientRect();
      scan(main, r.left, r.right);
    }
  }
  // Make the failure screenshot useful: outline the culprits and bring the first one into view.
  for (const el of found) el.style.outline = '2px solid red';
  found[0]?.scrollIntoView({ block: 'center', inline: 'nearest' });
  return result;
}

function slug(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

class CaseRun {
  constructor({ scenario, vpKey, themeKey, page, router, origin }) {
    this.scenario = scenario;
    this.id = `${scenario.id}-${vpKey}-${themeKey}`;
    this.title = `${scenario.title} · ${VIEWPORTS[vpKey].label} · ${THEMES[themeKey].label}`;
    this.vpKey = vpKey;
    this.viewport = VIEWPORTS[vpKey];
    this.isMobile = Boolean(VIEWPORTS[vpKey].isMobile);
    this.theme = themeKey;
    this.page = page;
    this.router = router;
    this.journal = router.journal;
    this.state = router.state;
    this.origin = origin;
    this.authenticated = scenario.auth !== false;
    this.checks = [];
    this.consoleLog = [];
    this.allowedErrors = [];
    this.errors = [];
    this.blockedUrls = new Set();
    this.screenshots = [];
  }

  // ---- event sinks
  onConsole(msg) {
    const loc = msg.location();
    const entry = { type: msg.type(), text: msg.text(), url: loc?.url ?? '' };
    this.consoleLog.push(entry);
    if (this.consoleLog.length > 500) this.consoleLog.shift();
    if (entry.type !== 'error') return;
    const reason = allowedConsoleError(entry, this);
    if (reason) this.allowedErrors.push({ ...entry, reason });
    else this.errors.push(`console.error: ${firstLine(entry.text)}${entry.url ? ` [${entry.url}]` : ''}`);
  }

  onPageError(error) {
    const text = `${error.name ?? 'Error'}: ${error.message}`;
    this.consoleLog.push({ type: 'pageerror', text, url: '' });
    if (/\[vite\]|WebSocket closed without opened/i.test(text)) return;
    this.errors.push(`pageerror: ${firstLine(text)}`);
  }

  // ---- checks
  async #record(name, fn, { hard }) {
    const started = Date.now();
    try {
      await fn();
      this.checks.push({ name, status: 'pass', ms: Date.now() - started });
      return true;
    } catch (error) {
      if (error instanceof AbortCase) throw error;
      const check = { name, status: 'fail', detail: cleanError(error.message), ms: Date.now() - started };
      this.checks.push(check);
      check.screenshot = await this.screenshot(name);
      if (hard) throw new AbortCase(name);
      return false;
    }
  }

  // Soft check: a failure is recorded and the case goes on. Resolves to true when it passed.
  check(name, fn) {
    return this.#record(name, fn, { hard: false });
  }

  // Hard step: a failure aborts the rest of the case (the remaining checks would only time out).
  step(name, fn) {
    return this.#record(name, fn, { hard: true });
  }

  // A check that cannot run yet (the app does not have the hook). Visible in the report,
  // does not fail the run.
  expected(name, reason) {
    this.checks.push({ name, status: 'expected', detail: reason });
  }

  // A check that was not run because the one it depends on failed.
  skip(name, reason) {
    this.checks.push({ name, status: 'skip', detail: reason });
  }

  async screenshot(name) {
    try {
      await mkdir(ARTIFACTS, { recursive: true });
      const file = join(ARTIFACTS, `${this.id}--${this.screenshots.length + 1}-${slug(name)}.png`);
      await this.page.screenshot({ path: file, animations: 'disabled', timeout: 5_000 });
      this.screenshots.push(file);
      return relative(ROOT, file).split(sep).join('/');
    } catch {
      return null;
    }
  }

  // ---- helpers for scenarios
  async goto(path, { ready, readyName = 'страница загрузилась' } = {}) {
    const firstStep = this.checks.length === 0;
    try {
      await this.step(`${path}: ${readyName}`, async () => {
        await this.page.goto(path, { waitUntil: 'domcontentloaded' });
        if (ready) await ready().first().waitFor({ state: 'visible', timeout: READY_TIMEOUT_MS });
      });
    } catch (error) {
      // The very first page of the case did not load: the run loop counts these to stop early
      // when the whole app is down instead of timing out on every remaining case.
      if (firstStep) this.loadFailed = true;
      throw error;
    }
  }

  async visible(locator, what) {
    try {
      await locator.first().waitFor({ state: 'visible' });
    } catch {
      throw new Error(`не видно: ${what}`);
    }
  }

  async hidden(locator, what) {
    try {
      await locator.first().waitFor({ state: 'hidden' });
    } catch {
      throw new Error(`всё ещё видно: ${what}`);
    }
  }

  async waitFor(predicate, message, timeout = ACTION_TIMEOUT_MS) {
    const deadline = Date.now() + timeout;
    let last;
    for (;;) {
      try {
        last = await predicate();
        if (last === true || (last && last.ok)) return last;
      } catch (error) {
        last = error.message;
      }
      if (Date.now() > deadline) {
        const extra = typeof last === 'object' && last?.detail ? ` (${last.detail})` : typeof last === 'string' ? ` (${last})` : '';
        throw new Error(`${message}${extra}`);
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  assert(condition, message) {
    if (!condition) throw new Error(message);
  }

  // Common checks of a rendered page: no error screen, no horizontal scroll; on phones the
  // bottom navigation.
  async pageChecks(label, { bottomNav = this.authenticated } = {}) {
    await this.check(`${label}: нет экрана ошибки`, async () => {
      const found = await this.page.evaluate((markers) => {
        const text = document.body?.innerText ?? '';
        return markers.filter((m) => text.includes(m));
      }, ERROR_SCREEN_MARKERS);
      this.assert(found.length === 0, `на странице: «${found.join('», «')}»`);
    });
    await this.check(`${label}: нет горизонтальной прокрутки`, async () => {
      const r = await this.page.evaluate(measureOverflow, null);
      const parts = [];
      if (r.doc > 1) parts.push(`документ шире экрана на ${r.doc}px`);
      if (r.main !== null && r.main > 1) parts.push(`[data-pf-main] шире на ${r.main}px`);
      if (!parts.length && r.offenders.length) parts.push(`за краем экрана ${r.viewport}px (обрезано)`);
      if (parts.length) {
        throw new Error(`${parts.join(', ')}${r.offenders.length ? `; вылезают: ${r.offenders.join('; ')}` : ''}`);
      }
    });
    if (this.isMobile && bottomNav) {
      await this.check(`${label}: нижняя навигация видна, кнопки не ниже 44px`, async () => {
        const nav = this.page.locator('nav[aria-label="Основная навигация"]');
        await this.visible(nav, 'nav «Основная навигация»');
        const info = await nav.evaluate((el) => {
          const r = el.getBoundingClientRect();
          return {
            top: r.top,
            bottom: r.bottom,
            vh: window.innerHeight,
            buttons: [...el.querySelectorAll('button, a')].map((b) => ({
              label: b.getAttribute('aria-label') || (b.textContent ?? '').trim(),
              height: Math.round(b.getBoundingClientRect().height * 10) / 10,
            })),
          };
        });
        this.assert(info.bottom <= info.vh + 1 && info.top < info.vh, `навигация вне экрана (top ${info.top}, bottom ${info.bottom}, экран ${info.vh})`);
        this.assert(info.buttons.length > 0, 'в навигации нет кнопок');
        const small = info.buttons.filter((b) => b.height < 44 - 0.5);
        this.assert(small.length === 0, `кнопки ниже 44px: ${small.map((b) => `«${b.label}» ${b.height}px`).join(', ')}`);
      });
    }
  }

  // A dialog/sheet must fit the screen horizontally and its content must not be wider than it.
  async boxFitsCheck(label, selector) {
    await this.check(`${label}: помещается в экран по ширине`, async () => {
      let r;
      // Short retry: a sheet may still be settling after it opened.
      await this.waitFor(async () => {
        r = await this.page.evaluate(measureOverflow, selector);
        return !r.missing && r.box <= 1 && r.inner <= 1;
      }, 'не помещается', 2_000).catch(() => {});
      if (!r) throw new Error('не удалось измерить');
      if (r.missing) throw new Error(`не найден ${selector}`);
      const parts = [];
      if (r.box > 1) parts.push(`выходит за экран на ${r.box}px`);
      if (r.inner > 1) parts.push(`содержимое шире окна на ${r.inner}px`);
      if (parts.length) {
        throw new Error(`${parts.join(', ')}${r.offenders.length ? `; вылезают: ${r.offenders.join('; ')}` : ''}`);
      }
    });
  }

  // Waits until the router journal has a mutation matching `predicate`.
  async waitForMutation(predicate, message) {
    return this.waitFor(() => this.journal.mutations.some(predicate), message);
  }

  get failed() {
    return this.checks.some((c) => c.status === 'fail');
  }
}

async function runCase(browser, baseURL, scenario, vpKey, themeKey) {
  const vp = VIEWPORTS[vpKey];
  const theme = THEMES[themeKey];
  const origin = new URL(baseURL).origin;
  const router = createApiRouter({ authenticated: scenario.auth !== false });
  const context = await browser.newContext({
    baseURL,
    viewport: vp.viewport,
    deviceScaleFactor: vp.deviceScaleFactor ?? 1,
    isMobile: Boolean(vp.isMobile),
    hasTouch: Boolean(vp.hasTouch),
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    colorScheme: theme.colorScheme,
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  });
  context.setDefaultTimeout(ACTION_TIMEOUT_MS);
  context.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
  await context.addInitScript((storedTheme) => {
    try {
      localStorage.setItem('pf-theme', storedTheme);
    } catch {
      /* storage unavailable — the app falls back to the system theme */
    }
  }, theme.storedTheme);

  const page = await context.newPage();
  const run = new CaseRun({ scenario, vpKey, themeKey, page, router, origin });

  await context.route(
    (url) => url.origin === origin && (url.pathname === '/api' || url.pathname.startsWith('/api/')),
    (route) => router.handle(route),
  );
  await context.route(
    (url) => url.origin !== origin && (url.protocol === 'http:' || url.protocol === 'https:'),
    (route) => {
      run.blockedUrls.add(route.request().url());
      return route.abort('blockedbyclient');
    },
  );
  page.on('console', (msg) => run.onConsole(msg));
  page.on('pageerror', (error) => run.onPageError(error));

  const started = Date.now();
  let timer;
  // On timeout the scenario keeps running until the context closes; its late rejection
  // must not become an unhandled one.
  const scenarioDone = Promise.resolve().then(() => scenario.run(run));
  scenarioDone.catch(() => {});
  try {
    await Promise.race([
      scenarioDone,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`сценарий не уложился в ${CASE_TIMEOUT_MS / 1000} с`)), CASE_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    if (error instanceof AbortCase) {
      run.checks.push({ name: 'остальные проверки сценария пропущены после падения шага', status: 'skip' });
    } else {
      const check = { name: 'сценарий выполнился до конца', status: 'fail', detail: cleanError(error.message) };
      run.checks.push(check);
      check.screenshot = await run.screenshot(check.name);
    }
  } finally {
    clearTimeout(timer);
  }

  // Let late errors of the last action surface before judging the console.
  await page.waitForTimeout(150).catch(() => {});
  const errors = [...new Set(run.errors)];
  if (errors.length === 0) {
    run.checks.push({ name: 'нет ошибок в консоли и необработанных исключений', status: 'pass' });
  } else {
    const shown = errors.slice(0, 6).join('\n');
    run.checks.push({
      name: 'нет ошибок в консоли и необработанных исключений',
      status: 'fail',
      detail: `${errors.length} шт.:\n${shown}${errors.length > 6 ? `\n… и ещё ${errors.length - 6}` : ''}`,
    });
  }

  if (run.failed) await writeCaseLog(run);
  await context.close().catch(() => {});
  return { run, ms: Date.now() - started };
}

async function writeCaseLog(run) {
  await mkdir(ARTIFACTS, { recursive: true });
  const lines = [
    `Сценарий: ${run.title}`,
    `Адрес на момент записи: ${run.page.url()}`,
    '',
    'Проверки:',
    ...run.checks.map((c) => `  [${c.status}] ${c.name}${c.detail ? `\n      ${c.detail.replace(/\n/g, '\n      ')}` : ''}`),
    '',
    `Последние сообщения консоли (${Math.min(CONSOLE_TAIL, run.consoleLog.length)} из ${run.consoleLog.length}):`,
    ...run.consoleLog.slice(-CONSOLE_TAIL).map((m) => `  [${m.type}] ${m.text}${m.url ? ` (${m.url})` : ''}`),
    '',
    'Разрешённые ошибки консоли:',
    ...run.allowedErrors.slice(-20).map((m) => `  ${m.reason}: ${firstLine(m.text)}`),
    '',
    'Мутации (журнал роутера):',
    ...run.journal.mutations.map((m) => `  ${m.method} /api${m.path} ${JSON.stringify(m.body)}`),
    '',
    'Незамоканные эндпоинты:',
    ...[...new Set(run.journal.unknown)].map((u) => `  ${u}`),
    ...(run.journal.routerErrors.length
      ? ['', 'Ошибки роутера фикстур:', ...run.journal.routerErrors.map((e) => `  ${e}`)]
      : []),
  ];
  const file = join(ARTIFACTS, `${run.id}.log`);
  await writeFile(file, `${lines.join('\n')}\n`, 'utf8');
  run.logFile = relative(ROOT, file).split(sep).join('/');
}

// ------------------------------------------------------------- report ----

// Collapses fixture ids so the list of unmocked endpoints stays short.
function normalizeEndpoint(endpoint) {
  return endpoint.replace(/\/(p|t|u|ws|view|c)-[a-z0-9-]+/gi, '/:id');
}

function expandCases(filter) {
  const needles = filter ? filter.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) : [];
  const cases = [];
  for (const scenario of scenarios) {
    for (const [vpKey, themeKey] of scenario.matrix) {
      const id = `${scenario.id}-${vpKey}-${themeKey}`;
      const title = `${scenario.title} · ${VIEWPORTS[vpKey].label} · ${THEMES[themeKey].label}`;
      const haystack = `${id} ${title}`.toLowerCase();
      if (needles.length && !needles.some((n) => haystack.includes(n))) continue;
      cases.push({ scenario, vpKey, themeKey, id, title });
    }
  }
  return cases;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cases = expandCases(opts.only);

  if (opts.list) {
    for (const c of cases) console.log(`${c.id.padEnd(36)} ${c.title}`);
    return 0;
  }
  if (cases.length === 0) {
    console.error(`Нет сценариев под фильтр «${opts.only}» (см. --list).`);
    return 1;
  }

  let staticServer = null;
  let baseURL = opts.url ? opts.url.replace(/\/+$/, '') : null;
  if (!baseURL && !existsSync(join(DIST, 'index.html'))) {
    console.error('Нет собранного клиента (client/dist/index.html). Сначала npm run build:client — или укажите --url <адрес> запущенного клиента.');
    return 1;
  }

  const { browser, label, failures } = await launchBrowser({ headed: opts.headed });
  if (!browser) {
    const message = `Не найден браузер для смоук-тестов. Пробовали:\n  - ${failures.join('\n  - ')}\nУкажите путь к Chrome/Chromium в CHROME_PATH.`;
    if (process.env.SMOKE_ALLOW_SKIP === '1') {
      console.warn(`${yellow('ВНИМАНИЕ')}: ${message}\nСмоук пропущен (SMOKE_ALLOW_SKIP=1).`);
      return 0;
    }
    console.error(message);
    return 1;
  }

  await rm(ARTIFACTS, { recursive: true, force: true });
  if (!baseURL) {
    staticServer = await startStaticServer(DIST);
    baseURL = staticServer.url;
  }

  console.log(bold('Смоук-тесты ProjectsFlow'));
  console.log(dim(`Клиент: ${baseURL}${staticServer ? ' (client/dist)' : ''} · браузер: ${label} · сценариев: ${cases.length}`));
  console.log('');

  const startedAll = Date.now();
  const results = [];
  let stoppedEarly = 0;
  try {
    let loadFailuresInRow = 0;
    for (const [index, c] of cases.entries()) {
      if (loadFailuresInRow >= LOAD_FAILURES_TO_STOP) {
        stoppedEarly = cases.length - index;
        console.log(red(`\nПриложение не загружается в ${LOAD_FAILURES_TO_STOP} сценариях подряд — остальные ${stoppedEarly} пропущены.`));
        break;
      }
      const { run, ms } = await runCase(browser, baseURL, c.scenario, c.vpKey, c.themeKey);
      results.push({ run, ms });
      loadFailuresInRow = run.loadFailed ? loadFailuresInRow + 1 : 0;
      const mark = run.failed ? MARK.fail : run.checks.some((ch) => ch.status === 'expected') ? MARK.expected : MARK.pass;
      const counted = run.checks.filter((ch) => ch.status !== 'skip').length;
      console.log(`${mark} ${run.title} ${dim(`(${checksWord(counted)}, ${seconds(ms)})`)}`);
      for (const ch of run.checks) {
        if (ch.status === 'pass' && !run.failed && !opts.verbose) continue;
        console.log(`    ${MARK[ch.status]} ${ch.name}`);
        if (ch.detail && ch.status !== 'pass') {
          for (const line of String(ch.detail).split('\n')) console.log(dim(`        ${line}`));
        }
        if (ch.screenshot) console.log(dim(`        скриншот: ${ch.screenshot}`));
      }
      if (run.failed && run.logFile) console.log(dim(`    журнал: ${run.logFile}`));
      if (opts.verbose && run.allowedErrors.length) {
        const reasons = [...new Set(run.allowedErrors.map((e) => e.reason))];
        console.log(dim(`    разрешённые ошибки консоли: ${run.allowedErrors.length} (${reasons.join('; ')})`));
      }
    }
  } finally {
    await browser.close().catch(() => {});
    if (staticServer) await new Promise((r) => staticServer.server.close(r));
  }

  const all = results.flatMap((r) => r.run.checks);
  const count = (status) => all.filter((c) => c.status === status).length;
  const failedCases = results.filter((r) => r.run.failed).length;

  const unknown = new Map();
  for (const { run } of results) {
    for (const endpoint of run.journal.unknown) {
      const key = normalizeEndpoint(endpoint);
      if (!unknown.has(key)) unknown.set(key, new Set());
      unknown.get(key).add(run.scenario.id);
    }
  }
  const blocked = new Set(results.flatMap((r) => [...r.run.blockedUrls].map((u) => new URL(u).origin)));
  const routerErrors = [...new Set(results.flatMap((r) => r.run.journal.routerErrors))];

  console.log('');
  if (unknown.size) {
    console.log(bold(`Незамоканные эндпоинты (ответ {} / {ok:true}), ${unknown.size}:`));
    for (const [endpoint, ids] of [...unknown.entries()].sort()) {
      console.log(dim(`  ${endpoint}  ← ${[...ids].join(', ')}`));
    }
  } else {
    console.log(dim('Незамоканных эндпоинтов нет: на все запросы /api ответили фикстуры.'));
  }
  if (blocked.size) console.log(dim(`Внешние запросы заблокированы: ${[...blocked].join(', ')}`));
  if (routerErrors.length) {
    console.log(red(`Ошибки в роутере фикстур смоука (чинить e2e/smoke/fixtures.mjs, не приложение):`));
    for (const e of routerErrors) console.log(red(`  ${e}`));
  }
  if (staticServer?.leaks.length) {
    console.log(red(`Запросы /api дошли до статического сервера (не перехвачены в браузере): ${[...new Set(staticServer.leaks)].join(', ')}`));
  }
  const failedChecks = results.flatMap(({ run }) =>
    run.checks.filter((ch) => ch.status === 'fail').map((ch) => ({ run, ch })),
  );
  if (failedChecks.length) {
    console.log(bold(red(`Упавшие проверки (${failedChecks.length}):`)));
    for (const { run, ch } of failedChecks) {
      console.log(`  ${MARK.fail} ${run.title} → ${ch.name}`);
      console.log(dim(`      ${firstLine(ch.detail)}`));
    }
  }
  const summary = [
    `${casesWord(results.length)}, ${checksWord(all.length)}`,
    green(`прошло ${count('pass')}`),
    count('fail') ? red(`упало ${count('fail')} (${casesWord(failedCases)})`) : null,
    count('expected') ? yellow(`ждут доработки приложения: ${count('expected')}`) : null,
    count('skip') ? dim(`пропущено: ${count('skip')}`) : null,
    stoppedEarly ? red(`не запускались: ${casesWord(stoppedEarly)}`) : null,
  ].filter(Boolean);
  console.log(`${bold('Итого:')} ${summary.join(' · ')} · ${seconds(Date.now() - startedAll)}`);
  if (count('fail')) console.log(dim(`Скриншоты и журналы: ${relative(ROOT, ARTIFACTS).split(sep).join('/')}/`));
  const leaked = Boolean(staticServer?.leaks.length);
  return count('fail') > 0 || leaked || stoppedEarly > 0 || routerErrors.length > 0 ? 1 : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(error);
    process.exitCode = 1;
  },
);
