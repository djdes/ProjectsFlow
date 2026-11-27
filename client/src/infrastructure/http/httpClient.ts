// Тонкая обёртка над fetch. Базовый URL — относительный /api,
// потому что Vite-dev-proxy + продовая сборка (same-origin) обе работают так.
// `credentials: 'include'` — обязательно для cookie-сессий.

import { HttpError, type HttpErrorBody } from '@/lib/HttpError';
import { announceReadRefreshed, type ReadRefreshTopic } from '@/lib/readRefreshed';
import { TAB_ID } from '@/lib/tabId';
import { InFlightReads } from './InFlightReads';
import { ReadCache, readCachePolicy, type ReadPolicy } from './ReadCache';
import { fetchWithDeadline } from './fetchWithDeadline';
import {
  cacheStorageStore,
  fitsOfflineStore,
  isNetworkFailure,
  isOfflineCacheable,
  offlineKey,
  offlinePathOf,
  readOfflineOwner,
  writeOfflineOwner,
} from './offlineReads';

const reads = new InFlightReads();
// Background re-reads of kept answers, one per cache key at a time.
const revalidating = new Map<string, Promise<void>>();
// Parts of combined reads in flight (ReadOptions.parts), by cache key: a separate read of one
// of them waits for the combined answer instead of sending its own request.
const pendingParts = new Map<string, Promise<void>>();
// Answers fetched ahead of a reader that is about to ask (a task window starts its reads at the
// first frame, before its sections mount): the first read of the same path takes it, once,
// within a few seconds. Paths that are not cached only; cached ones simply warm the cache.
const PREFETCH_TTL = 5_000;
const prefetched = new Map<string, { readonly until: number; readonly raw: Promise<Raw> }>();
let requestWorkspace: string | null = null;
// Offline reading (offlineReads.ts): the account the stored reads belong to.
const offlineStore = cacheStorageStore();
let offlineOwner: string | null = readOfflineOwner();
// Serialize Cache Storage mutations (put / deleteMatching / clear) so a slow put from an
// older read can never overtake an invalidation triggered by a newer write.
let offlineQueue: Promise<void> = Promise.resolve();
function enqueueOffline(op: () => Promise<void>): void {
  offlineQueue = offlineQueue.then(op).catch(() => undefined);
}

// Stable resources (project settings, members, the project list…) are not re-read on every
// task opening and page visit: see ReadCache.ts for what is kept and what clears it.
// A change (own write or one made elsewhere) also stops sharing reads already in flight: a
// reader asking after it must not get an answer sent before it.
const cache = new ReadCache(undefined, (kind, matches) => {
  reads.invalidate();
  pendingParts.clear();
  if (kind === 'dropped') {
    // An own write may have changed what was fetched ahead or revalidating in the background.
    prefetched.clear();
    revalidating.clear();
    const owner = offlineOwner;
    if (owner && offlineStore) {
      enqueueOffline(() =>
        offlineStore.deleteMatching((key) => {
          const entryPath = offlinePathOf(key, owner);
          return entryPath !== null && matches(entryPath);
        }),
      );
    }
  }
});
if (typeof window !== 'undefined') cache.listen(window);

function forgetOfflineReads(): void {
  offlineOwner = null;
  writeOfflineOwner(null);
  cache.clear();
  if (offlineStore) enqueueOffline(() => offlineStore.clear());
}

function rememberOfflineOwner(data: unknown): void {
  const id = (data as { user?: { id?: unknown } } | null)?.user?.id;
  if (typeof id !== 'string' || id === offlineOwner) return;
  // Another account on this device: the previous account's reads must not be shown offline.
  if (offlineOwner && offlineStore) enqueueOffline(() => offlineStore.clear());
  offlineOwner = id;
  writeOfflineOwner(id);
}
export function setRequestWorkspace(workspaceId: string | null): void {
  if (requestWorkspace !== workspaceId) reads.invalidate();
  requestWorkspace = workspaceId;
  if (workspaceId) warmFromSaved(workspaceId);
}

// Re-export для удобства infrastructure-слоя; presentation должен импортировать из '@/lib/HttpError'.
export { HttpError };
export type { HttpErrorBody };

type Options = {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  readonly body?: unknown;
  readonly timeoutMs?: number;
  // Per-request workspace override: reads another workspace the user belongs to without
  // switching the tab. The server rejects non-member workspaces with 404.
  readonly workspaceId?: string;
};

// A response: parsed data, the body as received (compared to tell whether anything changed),
// whether it came from the offline copy because the network was down, when the request was
// sent (what changed after that may not be in it), and the monotonic cache-change sequence
// captured before the request started (null for saved copies read from disk).
type Raw = {
  readonly data: unknown;
  readonly text: string | null;
  readonly offline: boolean;
  readonly sentAt: number;
  readonly readSeq: number | null;
};

async function request<T>(path: string, opts: Options = {}): Promise<T> {
  return (await requestRaw(path, opts)).data as T;
}

async function requestRaw(path: string, opts: Options = {}): Promise<Raw> {
  const sentAt = Date.now();
  const readSeq = cache.currentSeq();
  const workspace = opts.workspaceId ?? requestWorkspace;
  const method = opts.method ?? 'GET';
  const init: RequestInit = {
    method,
    credentials: 'include',
    // Never let the browser HTTP cache serve stale mutable API JSON (ReadCache handles memory/SWR).
    cache: 'no-store',
    headers: { Accept: 'application/json',
      ...(workspace && !/^\/(auth|workspaces)(\/|$)/.test(path) ? { 'X-Workspace-Id': workspace } : {}),
      // Tag own-tab mutations so our own SSE echo does not stale the fresh post-write read;
      // exclude workspace chat endpoints whose AI assistant may create/modify tasks asynchronously
      // without ReadCache.afterWrite dropping task lists.
      ...(method !== 'GET' && !/^\/workspaces\/[^/]+\/chat(\/|$)/.test(path) ? { 'X-Tab-Id': TAB_ID } : {}),
    },
  };

  if (opts.body !== undefined) {
    init.headers = { ...init.headers, 'Content-Type': 'application/json' };
    init.body = JSON.stringify(opts.body);
  }

  const isRead = init.method === 'GET' && isOfflineCacheable(path);
  let fetched: Awaited<ReturnType<typeof fetchWithDeadline>>;
  try {
    fetched = await fetchWithDeadline(
      `/api${path}`, init, opts.timeoutMs ?? (init.method === 'GET' ? 45000 : 90000),
    );
  } catch (error) {
    // No network: answer a read from the last saved copy of this account and workspace.
    if (isRead && offlineOwner && offlineStore && isNetworkFailure(error)) {
      await offlineQueue;
      const saved = await offlineStore.get(offlineKey(offlineOwner, workspace, path)).catch(() => null);
      if (saved !== null) {
        try {
          window.dispatchEvent(new CustomEvent('pf:offline-read', { detail: { path } }));
        } catch {
          /* non-browser environment */
        }
        return { data: JSON.parse(saved) as unknown, text: saved, offline: true, sentAt, readSeq: null };
      }
    }
    throw error;
  }
  const { response: res, text } = fetched;
  if (res.ok && init.method === 'POST' && path === '/auth/logout') forgetOfflineReads();

  if (res.status === 204) return { data: undefined, text: null, offline: false, sentAt, readSeq };

  // JSON.parse под try/catch: nginx 502/504 отдаёт HTML, а не JSON — без гарда
  // наверх летел бы SyntaxError вместо HttpError, и все `instanceof HttpError`-ветки
  // не срабатывали. При провале парса на не-ok — HttpError с реальным статусом.
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      if (!res.ok) {
        throw new HttpError(res.status, { error: 'non_json_response' });
      }
      // 2xx, но тело не JSON — неожиданно; отдаём null (вызывающий разберётся).
      data = null;
    }
  }

  if (!res.ok) {
    // 401 в середине сессии — сообщаем всему приложению одним событием: AuthProvider
    // переведёт статус в anonymous, ProtectedRoute уведёт на /login с возвратом.
    // The session probe owns its result; a late probe must not undo a newer login.
    if (res.status === 401) forgetOfflineReads();
    if (res.status === 401 && !(path === '/auth/me' && init.method === 'GET')) {
      reads.invalidate();
      try {
        window.dispatchEvent(new CustomEvent('pf:session-expired'));
      } catch {
        // не-браузерное окружение — событие некому слушать, игнорируем.
      }
    }
    const body = (data as HttpErrorBody | null) ?? { error: 'unknown_error' };
    throw new HttpError(res.status, body);
  }

  if (isRead) {
    if (path === '/auth/me') rememberOfflineOwner(data);
    // Never write a pre-mutation response to the device store: it would resurrect old state on
    // SWR re-reads or page reload. Stamp `sentAt` (when requested), not response arrival time.
    const owner = offlineOwner;
    if (owner && offlineStore && fitsOfflineStore(text) && cache.changedSince(path, sentAt, readSeq) !== 'dropped') {
      const storageKey = offlineKey(owner, workspace, path);
      enqueueOffline(async () => {
        if (offlineOwner !== owner || cache.changedSince(path, sentAt, readSeq) === 'dropped') return;
        await offlineStore.put(storageKey, text, sentAt);
      });
    }
  }
  return { data, text, offline: false, sentAt, readSeq };
}

async function mutate<T>(path: string, opts: Options): Promise<T> {
  reads.invalidate();
  // Drop and advance readSeq before the write is sent so any earlier in-flight GET that
  // resolves while this mutation is still running cannot store stale pre-write state.
  cache.afterWrite(path);
  try { return await request<T>(path, opts); }
  finally {
    reads.invalidate();
    // Also on failure: the server may have applied part of the change.
    cache.afterWrite(path);
  }
}

type ReadOptions = Pick<Options, 'timeoutMs' | 'workspaceId'> & {
  // The caller follows pf:read-refreshed (lib/readRefreshed): it may get a kept, older answer at
  // once — no skeleton — while a fresh one loads, and re-reads when that one differs.
  readonly swr?: boolean;
  // A combined answer: each listed property is also the answer of that separate path. Fresh
  // network answers fill those entries too, so separate readers (badges) need no request.
  readonly parts?: Readonly<Record<string, string>>;
};

/**
 * An answer and the body it was parsed from. The same body means the same data: a repository
 * may hand out the objects it built for it last time, and React then skips the re-render.
 */
export type Answer<T> = { readonly data: T; readonly text: string | null };

const keyOf = (path: string, workspaceId?: string): string => `${workspaceId ?? requestWorkspace ?? 'account'}:${path}`;

const readKeyOf = (path: string, options?: ReadOptions): string => `${keyOf(path, options?.workspaceId)}:${options?.timeoutMs ?? 45000}`;

function fetchRaw(path: string, options?: ReadOptions): Promise<Raw> {
  return reads.get(readKeyOf(path, options), () => requestRaw(path, options));
}

function refreshTopicOf(path: string): ReadRefreshTopic {
  const bare = path.split('?')[0]!;
  if (bare === '/inbox' || bare.startsWith('/assignees/')) return 'inbox';
  if (bare === '/projects') return 'projects';
  if (/^\/projects\/[^/]+\/tasks$/.test(bare)) return 'tasks';
  if (bare === '/me/shared-members') return 'members';
  return 'other';
}

/** Network read of a cacheable path, stored under the cache's rules (ReadCache.store). */
async function loadAndStore(
  path: string,
  options: ReadOptions | undefined,
  cacheKey: string,
  policy: ReadPolicy,
): Promise<{ readonly raw: Raw; readonly stored: boolean }> {
  const parts = Object.entries(options?.parts ?? {}).map(([property, partPath]) => ({
    property, path: partPath, key: keyOf(partPath, options?.workspaceId),
  }));
  let settle = (): void => undefined;
  const settled = new Promise<void>((resolve) => {
    settle = resolve;
  });
  for (const part of parts) pendingParts.set(part.key, settled);
  try {
    const raw = await fetchRaw(path, options);
    if (raw.offline) return { raw, stored: false };
    const stored = cache.store(cacheKey, path, raw.data, policy, raw.text, raw.sentAt, raw.readSeq ?? undefined);
    for (const part of parts) {
      const partPolicy = readCachePolicy(part.path);
      const value = (raw.data as Record<string, unknown> | null)?.[part.property];
      if (partPolicy && value !== undefined) {
        cache.store(part.key, part.path, value, partPolicy, JSON.stringify(value), raw.sentAt, raw.readSeq ?? undefined);
      }
    }
    return { raw, stored };
  } catch (error) {
    // Gone or no longer allowed: what is kept must not be shown any more. Screens showing it
    // re-read and get the error themselves. A server failure or a lost network keeps it.
    if (error instanceof HttpError && (error.status === 403 || error.status === 404)) {
      cache.drop((entryPath) => entryPath === path || parts.some((part) => part.path === entryPath));
      announceReadRefreshed(refreshTopicOf(path));
    }
    throw error;
  } finally {
    settle();
    for (const part of parts) if (pendingParts.get(part.key) === settled) pendingParts.delete(part.key);
  }
}

/** Fresh copy of a kept answer in the background; readers are told only if stored and changed. */
function revalidate(path: string, options: ReadOptions | undefined, cacheKey: string, policy: ReadPolicy, shown: string | null): void {
  if (revalidating.has(cacheKey)) return;
  const run = loadAndStore(path, options, cacheKey, policy)
    .then(({ raw, stored }) => {
      if (!raw.offline && stored && raw.text !== shown) announceReadRefreshed(refreshTopicOf(path));
    })
    .catch(() => {
      /* The kept answer stays on screen; the next read tries again. */
    })
    .finally(() => {
      if (revalidating.get(cacheKey) === run) revalidating.delete(cacheKey);
    });
  revalidating.set(cacheKey, run);
}

/**
 * The copy of `path` saved on this device, if it is recent enough for `policy` and no own write
 * since it was saved may have changed it.
 */
async function readSaved(path: string, workspaceId: string | undefined, policy: ReadPolicy): Promise<{ raw: Raw; savedAt: number } | null> {
  if (!offlineOwner || !offlineStore) return null;
  try {
    // Wait for any pending invalidation delete so a copy being dropped is never read back.
    await offlineQueue;
    if (!offlineOwner) return null;
    const saved = await offlineStore.read(offlineKey(offlineOwner, workspaceId ?? requestWorkspace, path));
    if (!saved || saved.savedAt === null || Date.now() - saved.savedAt > policy.keep) return null;
    if (cache.changedSince(path, saved.savedAt) === 'dropped') return null;
    const raw: Raw = { data: JSON.parse(saved.text) as unknown, text: saved.text, offline: false, sentAt: saved.savedAt, readSeq: null };
    return { raw, savedAt: saved.savedAt };
  } catch {
    return null;
  }
}

/**
 * Nothing in memory (a cold start): the copy saved on this device and the network race. The
 * saved copy usually answers within milliseconds and is shown at once; the network answer then
 * replaces it and readers are told if it differs. A fast network simply wins.
 */
function raceSaved(path: string, options: ReadOptions | undefined, cacheKey: string, policy: ReadPolicy): Promise<Raw> {
  const network = loadAndStore(path, options, cacheKey, policy);
  const saved = readSaved(path, options?.workspaceId, policy);
  return new Promise<Raw>((resolve, reject) => {
    let shown: Raw | null = null;
    let failed = false;
    const show = (raw: Raw): void => {
      shown = raw;
      resolve(raw);
    };
    saved.then((copy) => {
      if (shown || failed || !copy) return;
      // Kept as stale until the racing network answer arrives. If an own write happened while
      // reading from disk, store() rejects it and we wait for the network instead.
      const stored = cache.store(cacheKey, path, copy.raw.data, policy, copy.raw.text, copy.savedAt, undefined, { stale: true });
      if (!stored) return;
      show(copy.raw);
    });
    network.then(
      ({ raw, stored }) => {
        if (!shown) show(raw);
        else if (!raw.offline && stored && raw.text !== shown.text) announceReadRefreshed(refreshTopicOf(path));
      },
      (error: unknown) => {
        if (shown) return;
        // A server answer (an error, no access) is the answer: the saved copy stands in only
        // for a lost network.
        if (!isNetworkFailure(error)) {
          failed = true;
          reject(error);
          return;
        }
        void saved.then((copy) => {
          if (shown) return;
          if (copy && cache.changedSince(path, copy.savedAt) !== 'dropped') show(copy.raw);
          else reject(error);
        });
      },
    );
  });
}

function takePrefetched(cacheKey: string): Promise<Raw> | undefined {
  const ahead = prefetched.get(cacheKey);
  if (!ahead) return undefined;
  prefetched.delete(cacheKey);
  return ahead.until > Date.now() ? ahead.raw : undefined;
}

function prefetch(path: string, options?: ReadOptions): void {
  if (readCachePolicy(path)) {
    void readAnswer(path, options).catch(() => undefined);
    return;
  }
  const cacheKey = keyOf(path, options?.workspaceId);
  const known = prefetched.get(cacheKey);
  if (known && known.until > Date.now()) return;
  const raw = fetchRaw(path, options);
  const entry = { until: Date.now() + PREFETCH_TTL, raw };
  prefetched.set(cacheKey, entry);
  // A failed one is forgotten: the reader then asks the network itself.
  raw.catch(() => {
    if (prefetched.get(cacheKey) === entry) prefetched.delete(cacheKey);
  });
}

async function readAnswer<T>(path: string, options?: ReadOptions): Promise<Answer<T>> {
  const answer = (raw: Raw): Answer<T> => ({ data: raw.data as T, text: raw.text });
  const policy = readCachePolicy(path);
  const cacheKey = keyOf(path, options?.workspaceId);
  if (!policy) {
    const ahead = takePrefetched(cacheKey);
    if (!ahead) return answer(await fetchRaw(path, options));
    // Other readers asking while it is in flight (two parts of one window) share it.
    reads.adopt(readKeyOf(path, options), ahead);
    return answer(await ahead);
  }
  let hit = cache.lookup(cacheKey);
  if (hit && !hit.stale) return { data: hit.value as T, text: hit.text };
  const combined = pendingParts.get(cacheKey);
  if (combined) {
    if (options?.swr && hit) return { data: hit.value as T, text: hit.text };
    // A combined read that carries this answer is on its way: take it from there.
    await combined;
    hit = cache.lookup(cacheKey);
    if (hit && !hit.stale) return { data: hit.value as T, text: hit.text };
  }
  if (options?.swr) {
    if (hit) {
      revalidate(path, options, cacheKey, policy, hit.text);
      return { data: hit.value as T, text: hit.text };
    }
    return answer(await raceSaved(path, options, cacheKey, policy));
  }
  return answer((await loadAndStore(path, options, cacheKey, policy)).raw);
}

/** What is already known about `path` — fresh or kept — without a request: for a first render. */
function peekAnswer<T>(path: string, options?: Pick<Options, 'workspaceId'>): Answer<T> | undefined {
  if (!readCachePolicy(path)) return undefined;
  const hit = cache.lookup(keyOf(path, options?.workspaceId));
  return hit ? { data: hit.value as T, text: hit.text } : undefined;
}

// Read on almost every start: their saved copies are pulled into memory as soon as the
// workspace is known, so the first screen renders them synchronously (peek), not a skeleton.
// Stored as stale so a reload still revalidates against the server in the background.
const WARM_PATHS = ['/inbox', '/assignees/overview?excludeDone=1', '/assignees/overview', '/me/ui-prefs', '/projects', '/me/shared-members'];

function warmPath(path: string, workspaceId: string): void {
  const policy = readCachePolicy(path);
  const cacheKey = keyOf(path, workspaceId);
  if (!policy || cache.lookup(cacheKey)) return;
  void readSaved(path, workspaceId, policy).then((copy) => {
    if (!copy) return;
    // A network answer that arrived meanwhile is newer and stays (ReadCache.store).
    cache.store(cacheKey, path, copy.raw.data, policy, copy.raw.text, copy.savedAt, undefined, { stale: true });
    if (path === '/inbox') {
      const inboxId = (copy.raw.data as { project?: { id?: unknown } } | null)?.project?.id;
      if (typeof inboxId === 'string' && inboxId) warmPath(`/projects/${inboxId}/tasks`, workspaceId);
    }
  });
}

function warmFromSaved(workspaceId: string): void {
  if (!offlineOwner || !offlineStore) return;
  for (const path of WARM_PATHS) warmPath(path, workspaceId);
}

export const httpClient = {
  get: <T>(path: string, options?: ReadOptions) => readAnswer<T>(path, options).then((answer) => answer.data),
  // The same read with the body it came from (see Answer).
  read: <T>(path: string, options?: ReadOptions) => readAnswer<T>(path, options),
  peek: <T>(path: string, options?: Pick<Options, 'workspaceId'>) => peekAnswer<T>(path, options)?.data,
  peekAnswer: <T>(path: string, options?: Pick<Options, 'workspaceId'>) => peekAnswer<T>(path, options),
  // Starts a read a screen is about to make (see `prefetched`); its result goes to that read.
  prefetch: (path: string, options?: ReadOptions) => prefetch(path, options),
  post: <T>(path: string, body?: unknown) => mutate<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => mutate<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown) => mutate<T>(path, { method: 'PUT', body }),
  delete: <T>(path: string, body?: unknown) => mutate<T>(path, { method: 'DELETE', body }),
};

export type HttpClient = typeof httpClient;

// A board can read and mutate its workspace without changing the tab's selection.
export function workspaceHttpClient(workspaceId: string): HttpClient {
  return {
    get: <T>(path: string, options?: ReadOptions) => httpClient.get<T>(path, { ...options, workspaceId }),
    read: <T>(path: string, options?: ReadOptions) => httpClient.read<T>(path, { ...options, workspaceId }),
    peek: <T>(path: string) => httpClient.peek<T>(path, { workspaceId }),
    peekAnswer: <T>(path: string) => httpClient.peekAnswer<T>(path, { workspaceId }),
    prefetch: (path: string, options?: ReadOptions) => httpClient.prefetch(path, { ...options, workspaceId }),
    post: <T>(path: string, body?: unknown) => mutate<T>(path, { method: 'POST', body, workspaceId }),
    patch: <T>(path: string, body?: unknown) => mutate<T>(path, { method: 'PATCH', body, workspaceId }),
    put: <T>(path: string, body?: unknown) => mutate<T>(path, { method: 'PUT', body, workspaceId }),
    delete: <T>(path: string, body?: unknown) => mutate<T>(path, { method: 'DELETE', body, workspaceId }),
  };
}
