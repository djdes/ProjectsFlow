import assert from 'node:assert/strict';
import { test } from 'node:test';
import { INSTALL_BANNER_TTL_MS, installBannerHidden } from './installBanner';
import { installBannerExpected } from './loadingLayout';

function withStorage(values: Record<string, string>, run: () => void): void {
  const data = new Map(Object.entries(values));
  const g = globalThis as Record<string, unknown>;
  const saved = { localStorage: g.localStorage, matchMedia: g.matchMedia };
  g.localStorage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  g.matchMedia = () => ({ matches: false });
  try {
    run();
  } finally {
    Object.assign(g, saved);
  }
}

test('the boot copy of the install-banner rule agrees with installBanner.ts', () => {
  const now = Date.now();
  const cases: Record<string, string>[] = [
    {},
    { 'pf-install-dismissed': '1' },
    { 'pf-install-seen': String(now - 1000) },
    { 'pf-install-seen': String(now - INSTALL_BANNER_TTL_MS - 60_000) },
  ];
  for (const values of cases) {
    withStorage(values, () => {
      const storage = globalThis.localStorage as unknown as Pick<Storage, 'getItem' | 'setItem'>;
      assert.equal(installBannerExpected(), !installBannerHidden(storage, Date.now()), JSON.stringify(values));
    });
  }
});

test('installBannerExpected is self-contained (it is serialized into index.html)', () => {
  const source = String(installBannerExpected);
  assert.doesNotMatch(source, /installBannerHidden|INSTALL_|_installBanner|import/);
});
