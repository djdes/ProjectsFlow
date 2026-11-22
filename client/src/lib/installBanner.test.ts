import assert from 'node:assert/strict';
import { test } from 'node:test';
import { INSTALL_BANNER_TTL_MS, installBannerHidden, markInstallBannerSeen } from './installBanner';

function memory(init: Record<string, string> = {}) {
  const data = new Map(Object.entries(init));
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

test('banner is visible before it was ever seen', () => {
  assert.equal(installBannerHidden(memory(), 1_000), false);
});

test('banner stays visible during the first day and hides after it', () => {
  const s = memory();
  markInstallBannerSeen(s, 1_000);
  assert.equal(installBannerHidden(s, 1_000 + INSTALL_BANNER_TTL_MS - 1), false);
  assert.equal(installBannerHidden(s, 1_000 + INSTALL_BANNER_TTL_MS + 1), true);
});

test('marking again keeps the first moment', () => {
  const s = memory();
  markInstallBannerSeen(s, 1_000);
  markInstallBannerSeen(s, 9_000_000_000);
  assert.equal(s.getItem('pf-install-seen'), '1000');
});

test('explicit dismiss hides at once; garbage timestamps are ignored', () => {
  assert.equal(installBannerHidden(memory({ 'pf-install-dismissed': '1' }), 0), true);
  assert.equal(installBannerHidden(memory({ 'pf-install-seen': 'abc' }), 10 ** 12), false);
});
