import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { Window } from 'happy-dom';

const script = readFileSync(new URL('./recovery.js', import.meta.url), 'utf8');
function setup(storage = new Map<string, string>()) {
  const window = new Window({ url: 'https://projectsflow.ru/login' });
  const document = window.document;
  document.body.innerHTML = '<div id="root"><div id="pf-boot">loading</div></div>';
  let now = 0;
  let reloads = 0;
  let id = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const network = { onLine: true };
  runInNewContext(script, {
    window, document, navigator: network,
    location: { pathname: '/login', reload: () => { reloads += 1; } },
    Date: { now: () => now },
    sessionStorage: {
      getItem: (key: string) => storage.get(key),
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
    setTimeout: (callback: () => void, delay: number) => { timers.set(++id, { at: now + delay, callback }); return id; },
    clearTimeout: (key: number) => timers.delete(key),
  });
  return {
    document, network, storage,
    reloads: () => reloads,
    event: (name: string) => window.dispatchEvent(new window.Event(name)),
    advance(ms: number) {
      now += ms;
      for (const [key, timer] of timers) {
        if (timer.at <= now) { timers.delete(key); timer.callback(); }
      }
    },
  };
}
test('missing entry JavaScript exposes recovery even though React never runs', () => {
  const page = setup();
  page.advance(20000);
  assert.match(page.document.getElementById('pf-boot-recovery')!.textContent, /Повторить загрузку/);
  assert.equal(page.reloads(), 0, 'slow downloads are not restarted automatically');
  page.document.querySelector('button')!.click();
  assert.equal(page.reloads(), 1);
});
test('online recovery retries once across document reloads, without loops', () => {
  const page = setup();
  page.network.onLine = false;
  page.event('vite:preloadError');
  page.advance(800);
  assert.equal(page.reloads(), 0);
  page.network.onLine = true;
  page.event('online');
  page.event('online');
  assert.equal(page.reloads(), 1);
  const reloaded = setup(page.storage);
  reloaded.event('vite:preloadError');
  reloaded.advance(800);
  assert.equal(reloaded.reloads(), 0);
  assert.ok(reloaded.document.getElementById('pf-boot-recovery'));
});
test('successful mount cancels the watchdog; later failures never discard unsaved input', () => {
  const page = setup();
  page.event('pf:app-ready');
  page.advance(30000);
  assert.equal(page.document.getElementById('pf-boot-recovery'), null);
  page.event('vite:preloadError');
  assert.equal(page.document.getElementById('pf-boot-recovery'), null, 'failed speculative preloads do not cover a working page');
  page.event('pf:page-load-error');
  page.event('online');
  page.advance(1000);
  assert.equal(page.reloads(), 0);
  assert.ok(page.document.getElementById('pf-boot-recovery'));
});
