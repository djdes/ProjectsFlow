// Offline reading (phone PWA): the last successful GET of each read endpoint is kept in the
// page's Cache Storage, keyed by account and workspace, and served when the network is gone.
// Mutations are never queued — the banner says changes will not be saved. The store is wiped
// on logout, on an expired session and when another account signs in on this device.

export type OfflineStore = {
  put(key: string, text: string): Promise<void>;
  get(key: string): Promise<string | null>;
  clear(): Promise<void>;
};

const CACHE_NAME = 'pf-offline-reads-v1';
const MAX_BYTES = 400_000;
const OWNER_KEY = 'pf-offline-owner';

/** Read endpoints worth keeping: JSON lists and cards, not auth flows, streams or files. */
export function isOfflineCacheable(path: string): boolean {
  if (path === '/auth/me') return true;
  if (/^\/auth(\/|$)/.test(path)) return false;
  if (/\/(stream|events|download|export)(\/|\?|$)/.test(path)) return false;
  return true;
}

export function offlineKey(owner: string, workspace: string | null, path: string): string {
  return `/__pf/offline/${encodeURIComponent(owner)}/${encodeURIComponent(workspace ?? 'account')}${path.startsWith('/') ? '' : '/'}${path}`;
}

/** fetch rejected (no network, DNS, aborted by our deadline) — not an HTTP error status. */
export function isNetworkFailure(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof Error && /не ответил вовремя/.test(error.message));
}

export function fitsOfflineStore(text: string): boolean {
  return text.length > 0 && text.length <= MAX_BYTES;
}

export function cacheStorageStore(): OfflineStore | null {
  if (typeof caches === 'undefined') return null;
  return {
    async put(key, text) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(key, new Response(text, { headers: { 'Content-Type': 'application/json' } }));
    },
    async get(key) {
      const cache = await caches.open(CACHE_NAME);
      const hit = await cache.match(key);
      return hit ? hit.text() : null;
    },
    async clear() {
      await caches.delete(CACHE_NAME);
    },
  };
}

export function readOfflineOwner(): string | null {
  try {
    return localStorage.getItem(OWNER_KEY);
  } catch {
    return null;
  }
}

export function writeOfflineOwner(owner: string | null): void {
  try {
    if (owner) localStorage.setItem(OWNER_KEY, owner);
    else localStorage.removeItem(OWNER_KEY);
  } catch {
    /* storage unavailable — offline reading just stays off */
  }
}
