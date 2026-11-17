/* ProjectsFlow service worker: device push notifications and the offline app shell.
 *
 * Registered from src/main.tsx in production builds only. At build time the pwa-service-worker
 * plugin (vite.config.ts) replaces the build id and the file lists below, so every deploy ships
 * a new sw.js: the browser installs it, it takes over open tabs at once and deletes the caches
 * of the previous build.
 *
 * What is cached:
 * - /assets/* (content-hashed, immutable file names): cache first, then network;
 * - the app shell (index.html) as a fallback only: navigations always go to the network and use
 *   the cache only when there is no network or it does not answer within a few seconds. A fresh
 *   index.html is therefore loaded right after a deploy, exactly as without a service worker.
 * /api/* responses are never cached: they hold data of a specific account and workspace.
 */

const BUILD = 'dev';
// Files referenced by index.html: the app cannot start offline without them.
const PRECACHE = [];
// Every /assets/* file of this build: unchanged ones are carried over from the previous cache.
const ASSETS = [];

const CACHE_PREFIX = 'pf-';
const SHELL_CACHE = `${CACHE_PREFIX}shell-${BUILD}`;
const ASSET_CACHE = `${CACHE_PREFIX}assets-${BUILD}`;
// Cache key of the shell; nothing is ever requested from the network under this path.
const SHELL_KEY = '/__pf/app-shell';
// A copy of index.html written by the build plugin; on prod /index.html serves the landing page.
const SHELL_URL = '/app-shell.html';
// Marker of the app's index.html: the landing page and other pages never become the shell.
const SHELL_MARKER = '<meta name="pf-app-shell"';
const NAVIGATION_TIMEOUT_MS = 3500;

// ---------------------------------------------------------------- lifecycle

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(precache());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, ASSET_CACHE]);
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith(CACHE_PREFIX) && !keep.has(name))
      .map((name) => caches.delete(name)));
    // The navigation request starts in parallel with the service worker boot.
    if (self.registration.navigationPreload) {
      await self.registration.navigationPreload.enable().catch(() => undefined);
    }
    await self.clients.claim();
  })());
});

// Install caches only what an offline start needs: the app entry files and the shell.
// Unchanged files are copied from the previous build's cache instead of the network.
async function precache() {
  const assets = await caches.open(ASSET_CACHE);
  const wanted = new Set(ASSETS);
  for (const name of await caches.keys()) {
    if (!name.startsWith(`${CACHE_PREFIX}assets-`) || name === ASSET_CACHE) continue;
    const previous = await caches.open(name);
    for (const request of await previous.keys()) {
      const path = new URL(request.url).pathname;
      if (!wanted.has(path) || (await assets.match(path))) continue;
      const response = await previous.match(request);
      if (response) await assets.put(path, response);
    }
  }
  await cacheMissing(assets, PRECACHE);
  try {
    await storeShell(await fetch(SHELL_URL, { cache: 'no-store', credentials: 'same-origin' }));
  } catch {
    // The shell is stored on the next successful navigation.
  }
}

// The remaining app files are fetched in the background when an open tab asks for it
// (src/lib/serviceWorker.ts), so any section opens offline, not only the visited ones.
async function cacheMissing(cache, paths) {
  const have = new Set((await cache.keys()).map((request) => new URL(request.url).pathname));
  const missing = paths.filter((path) => !have.has(path));
  for (let i = 0; i < missing.length; i += 4) {
    await Promise.all(missing.slice(i, i + 4).map(async (path) => {
      try {
        const response = await fetch(path);
        if (cacheable(response)) await cache.put(path, response);
      } catch {
        // Offline: the file is cached the first time a page requests it.
      }
    }));
  }
}

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'pf:warm-cache') {
    event.waitUntil(caches.open(ASSET_CACHE).then((cache) => cacheMissing(cache, ASSETS)).catch(() => undefined));
  }
});

// -------------------------------------------------------------------- fetch

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') {
    event.respondWith(navigate(event));
    return;
  }
  if (url.pathname.startsWith('/assets/') && !request.headers.has('range')) {
    event.respondWith(asset(event, url.pathname));
  }
});

function cacheable(response) {
  return Boolean(response) && response.status === 200 && response.type === 'basic';
}

async function asset(event, path) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(path);
  if (cached) return cached;
  const response = await fetch(event.request);
  if (cacheable(response)) {
    event.waitUntil(cache.put(path, response.clone()).catch(() => undefined));
  }
  return response;
}

function navigate(event) {
  let shellUpdate = Promise.resolve();
  const network = loadNavigation(event).then((response) => {
    // Clone before the page reads the body; HTML only, so a file download is not buffered twice.
    if (isHtml(response)) shellUpdate = storeShell(response.clone()).catch(() => undefined);
    return response;
  });
  // Even when the cache answered, the network response still refreshes the cached shell.
  event.waitUntil(network.then(() => shellUpdate, () => undefined));
  return respond(network);
}

async function loadNavigation(event) {
  const preloaded = await event.preloadResponse;
  return preloaded || fetch(event.request);
}

async function respond(network) {
  if (self.navigator && self.navigator.onLine === false) {
    const cached = await cachedShell();
    if (cached) return cached;
  }
  try {
    const response = await withTimeout(network, NAVIGATION_TIMEOUT_MS);
    // The server is restarting (a deploy) and nginx answers 502/503/504: show the saved version.
    if (response.status === 502 || response.status === 503 || response.status === 504) {
      const cached = await cachedShell();
      if (cached) return cached;
    }
    return response;
  } catch {
    const cached = await cachedShell();
    if (cached) return cached;
    return network;
  }
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

async function cachedShell() {
  try {
    const cache = await caches.open(SHELL_CACHE);
    return (await cache.match(SHELL_KEY)) || null;
  } catch {
    return null;
  }
}

function isHtml(response) {
  return Boolean(response) && (response.headers.get('content-type') || '').includes('text/html');
}

async function storeShell(response) {
  if (!response || !response.ok || response.type !== 'basic' || response.redirected || !isHtml(response)) return;
  const html = await response.text();
  if (!html.includes(SHELL_MARKER)) return;
  const cache = await caches.open(SHELL_CACHE);
  await cache.put(SHELL_KEY, new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' },
  }));
}

// --------------------------------------------------------------------- push

// Same-site paths only: a link from a push never leads to a foreign address.
function safePath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/';
  try {
    const url = new URL(value, self.location.origin);
    return url.origin === self.location.origin ? url.pathname + url.search + url.hash : '/';
  } catch {
    return '/';
  }
}

self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json() || {};
    } catch {
      data = { body: event.data.text() };
    }
  }
  const title = typeof data.title === 'string' && data.title.trim() ? data.title : 'ProjectsFlow';
  // Always show a notification: Safari revokes the subscription after pushes without one.
  event.waitUntil(self.registration.showNotification(title, {
    body: typeof data.body === 'string' ? data.body : '',
    icon: '/icon-192.png',
    badge: '/badge-96.png',
    lang: 'ru',
    data: {
      url: safePath(data.url),
      workspaceId: typeof data.workspaceId === 'string' ? data.workspaceId : null,
    },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const workspaceId = typeof data.workspaceId === 'string' ? data.workspaceId : null;
  event.waitUntil(openApp(safePath(data.url), workspaceId));
});

async function openApp(path, workspaceId) {
  const target = new URL(path, self.location.origin).href;
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const client = windows.find((c) => c.focused)
    || windows.find((c) => c.visibilityState === 'visible')
    || windows[0];
  if (client) {
    try {
      await client.focus();
    } catch {
      // Focus was not granted; the app still opens the right page.
    }
    // An open app navigates by itself, without a reload (and switches the workspace).
    if (await askAppToOpen(client, path, workspaceId)) return;
    if (typeof client.navigate === 'function') {
      try {
        await client.navigate(target);
        return;
      } catch {
        // The tab is not controlled by this service worker: open a new window.
      }
    }
  }
  if (self.clients.openWindow) await self.clients.openWindow(target);
}

function askAppToOpen(client, path, workspaceId) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(false), 1500);
    channel.port1.onmessage = () => {
      clearTimeout(timer);
      resolve(true);
    };
    try {
      client.postMessage({ type: 'pf:open-url', url: path, workspaceId }, [channel.port2]);
    } catch {
      clearTimeout(timer);
      resolve(false);
    }
  });
}

// The browser replaced the subscription (happens in Firefox): resubscribe with the same server
// key and report the new endpoint. Without a session the request fails; the person re-enables
// notifications in the profile.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const old = event.oldSubscription;
    const key = old && old.options ? old.options.applicationServerKey : null;
    const fresh = event.newSubscription
      || (key ? await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }) : null);
    if (!fresh) return;
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    await fetch('/api/push/subscriptions', {
      method: 'POST', credentials: 'same-origin', headers, body: JSON.stringify(fresh.toJSON()),
    }).catch(() => undefined);
    if (old && old.endpoint !== fresh.endpoint) {
      await fetch('/api/push/subscriptions', {
        method: 'DELETE', credentials: 'same-origin', headers, body: JSON.stringify({ endpoint: old.endpoint }),
      }).catch(() => undefined);
    }
  })().catch(() => undefined));
});
