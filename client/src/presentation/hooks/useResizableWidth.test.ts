// Тесты чистых хелперов ресайза дравера: clamp ширины в [min, viewport-зависимый max],
// порог переключения на двухпанельный split, и round-trip персиста в localStorage.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DRAWER_DEFAULT_WIDTH,
  DRAWER_MIN_WIDTH,
  DRAWER_SPLIT_CAP,
  drawerMaxWidth,
  clampDrawerWidth,
  computeIsSplit,
  readStoredWidth,
  writeStoredWidth,
  DRAWER_WIDTH_STORAGE_KEY,
} from './useResizableWidth';

test('drawerMaxWidth: доля вьюпорта (0.99), без жёсткого потолка в px', () => {
  // Без верхнего px-потолка — тянуть можно до ~99vw на любом мониторе (task 16).
  assert.equal(drawerMaxWidth(1000), 990);
  assert.equal(drawerMaxWidth(3000), 2970);
});

test('clampDrawerWidth: зажимает снизу в DRAWER_MIN_WIDTH', () => {
  assert.equal(clampDrawerWidth(100, 1920), DRAWER_MIN_WIDTH);
  assert.equal(clampDrawerWidth(DRAWER_MIN_WIDTH - 1, 1920), DRAWER_MIN_WIDTH);
});

test('clampDrawerWidth: зажимает сверху в viewport-зависимый max (0.99vw)', () => {
  // 1200 * 0.99 = 1188 → запрошенные 1300 режутся до 1188.
  assert.equal(clampDrawerWidth(1300, 1200), 1188);
  // На очень широком — режется до 0.99vw (без жёсткого px-потолка).
  assert.equal(clampDrawerWidth(5000, 4000), 3960);
});

test('clampDrawerWidth: значение в диапазоне проходит как есть (округлённое)', () => {
  assert.equal(clampDrawerWidth(900, 1920), 900);
  assert.equal(clampDrawerWidth(900.6, 1920), 901);
});

test('clampDrawerWidth: на крошечном вьюпорте min побеждает max', () => {
  // 300 * 0.96 = 288 < min(480) → отдаём min, не падаем ниже.
  assert.equal(clampDrawerWidth(400, 300), DRAWER_MIN_WIDTH);
});

test('clampDrawerWidth: NaN/мусор → дефолт затем clamp', () => {
  assert.equal(clampDrawerWidth(Number.NaN, 1920), DRAWER_DEFAULT_WIDTH);
  assert.equal(clampDrawerWidth(Number.POSITIVE_INFINITY, 1920), DRAWER_DEFAULT_WIDTH);
});

test('computeIsSplit: ниже порога (≈62vw, cap 1024) — стек', () => {
  // viewport 1000 → порог = min(620, 1024) = 620.
  assert.equal(computeIsSplit(619, 1000), false);
  assert.equal(computeIsSplit(620, 1000), true);
});

test('computeIsSplit: на широком вьюпорте порог упирается в cap 1024', () => {
  // viewport 2000 → 62vw=1240, но cap=1024 → split включается на 1024.
  assert.equal(computeIsSplit(DRAWER_SPLIT_CAP, 2000), true);
  assert.equal(computeIsSplit(DRAWER_SPLIT_CAP - 1, 2000), false);
});

test('readStoredWidth / writeStoredWidth: round-trip через localStorage', () => {
  installMemoryLocalStorage();
  try {
    assert.equal(readStoredWidth(), null);
    writeStoredWidth(1024.4);
    // Пишем округлённым.
    assert.equal(localStorage.getItem(DRAWER_WIDTH_STORAGE_KEY), '1024');
    assert.equal(readStoredWidth(), 1024);
  } finally {
    restoreLocalStorage();
  }
});

test('readStoredWidth: битое значение → null', () => {
  installMemoryLocalStorage();
  try {
    localStorage.setItem(DRAWER_WIDTH_STORAGE_KEY, 'not-a-number');
    assert.equal(readStoredWidth(), null);
  } finally {
    restoreLocalStorage();
  }
});

// --- минимальный in-memory localStorage для node-теста (без happy-dom) ---
let savedLocalStorage: Storage | undefined;
function installMemoryLocalStorage(): void {
  const store = new Map<string, string>();
  const mock = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
  savedLocalStorage = (globalThis as { localStorage?: Storage }).localStorage;
  Object.defineProperty(globalThis, 'localStorage', {
    value: mock,
    configurable: true,
    writable: true,
  });
}
function restoreLocalStorage(): void {
  Object.defineProperty(globalThis, 'localStorage', {
    value: savedLocalStorage,
    configurable: true,
    writable: true,
  });
}
