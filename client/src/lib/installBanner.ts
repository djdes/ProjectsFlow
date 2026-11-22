// The install banner sits under the mobile header on every page, so it is shown for one day
// only: the first time it appears its timestamp is stored, and after INSTALL_BANNER_TTL_MS it
// hides on its own (the profile page keeps the install card). An explicit «×» hides it at once.
export const INSTALL_DISMISS_KEY = 'pf-install-dismissed';
export const INSTALL_SEEN_KEY = 'pf-install-seen';
export const INSTALL_BANNER_TTL_MS = 24 * 60 * 60 * 1000;

type KeyValue = Pick<Storage, 'getItem' | 'setItem'>;

/** True when the banner must stay hidden: dismissed, or first seen more than a day ago. */
export function installBannerHidden(storage: KeyValue, now: number): boolean {
  if (storage.getItem(INSTALL_DISMISS_KEY) === '1') return true;
  const seen = Number(storage.getItem(INSTALL_SEEN_KEY));
  return Number.isFinite(seen) && seen > 0 && now - seen > INSTALL_BANNER_TTL_MS;
}

/** Stores the first time the banner was shown; later calls keep the original moment. */
export function markInstallBannerSeen(storage: KeyValue, now: number): void {
  const seen = Number(storage.getItem(INSTALL_SEEN_KEY));
  if (!(Number.isFinite(seen) && seen > 0)) storage.setItem(INSTALL_SEEN_KEY, String(now));
}
