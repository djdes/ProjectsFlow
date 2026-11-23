// Тонкая обёртка над fetch. Базовый URL — относительный /api,
// потому что Vite-dev-proxy + продовая сборка (same-origin) обе работают так.
// `credentials: 'include'` — обязательно для cookie-сессий.

import { HttpError, type HttpErrorBody } from '@/lib/HttpError';
import { InFlightReads } from './InFlightReads';
import { ReadCache, readCacheTtl } from './ReadCache';
import { fetchWithDeadline } from './fetchWithDeadline';
import {
  cacheStorageStore,
  fitsOfflineStore,
  isNetworkFailure,
  isOfflineCacheable,
  offlineKey,
  readOfflineOwner,
  writeOfflineOwner,
} from './offlineReads';

const reads = new InFlightReads();
// Stable resources (project settings, members, the project list…) are not re-read on every
// task opening and page visit: see ReadCache.ts for what is kept and what clears it.
const cache = new ReadCache();
if (typeof window !== 'undefined') cache.listen(window);
// Answers served from the offline copy while the network was down: never kept in `cache`.
let offlineAnswers = 0;
let requestWorkspace: string | null = null;
// Offline reading (offlineReads.ts): the account the stored reads belong to.
const offlineStore = cacheStorageStore();
let offlineOwner: string | null = readOfflineOwner();

function forgetOfflineReads(): void {
  offlineOwner = null;
  writeOfflineOwner(null);
  cache.clear();
  void offlineStore?.clear().catch(() => undefined);
}

function rememberOfflineOwner(data: unknown): void {
  const id = (data as { user?: { id?: unknown } } | null)?.user?.id;
  if (typeof id !== 'string' || id === offlineOwner) return;
  // Another account on this device: the previous account's reads must not be shown offline.
  if (offlineOwner) void offlineStore?.clear().catch(() => undefined);
  offlineOwner = id;
  writeOfflineOwner(id);
}
export function setRequestWorkspace(workspaceId: string | null): void {
  if (requestWorkspace !== workspaceId) reads.invalidate();
  requestWorkspace = workspaceId;
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

async function request<T>(path: string, opts: Options = {}): Promise<T> {
  const workspace = opts.workspaceId ?? requestWorkspace;
  const init: RequestInit = {
    method: opts.method ?? 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json',
      ...(workspace && !/^\/(auth|workspaces)(\/|$)/.test(path) ? { 'X-Workspace-Id': workspace } : {}),
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
      const saved = await offlineStore.get(offlineKey(offlineOwner, workspace, path)).catch(() => null);
      if (saved !== null) {
        offlineAnswers += 1;
        try {
          window.dispatchEvent(new CustomEvent('pf:offline-read', { detail: { path } }));
        } catch {
          /* non-browser environment */
        }
        return JSON.parse(saved) as T;
      }
    }
    throw error;
  }
  const { response: res, text } = fetched;
  if (res.ok && init.method === 'POST' && path === '/auth/logout') forgetOfflineReads();

  if (res.status === 204) return undefined as T;

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
    if (offlineOwner && offlineStore && fitsOfflineStore(text)) {
      void offlineStore.put(offlineKey(offlineOwner, workspace, path), text).catch(() => undefined);
    }
  }
  return data as T;
}

async function mutate<T>(path: string, opts: Options): Promise<T> {
  reads.invalidate();
  try { return await request<T>(path, opts); }
  finally {
    reads.invalidate();
    // Also on failure: the server may have applied part of the change.
    cache.afterWrite(path);
  }
}

function read<T>(path: string, options?: Pick<Options, 'timeoutMs' | 'workspaceId'>): Promise<T> {
  const workspace = options?.workspaceId ?? requestWorkspace ?? 'account';
  const ttl = readCacheTtl(path);
  const cacheKey = `${workspace}:${path}`;
  if (ttl !== null) {
    const hit = cache.get(cacheKey);
    if (hit !== undefined) return Promise.resolve(hit as T);
  }
  const generation = cache.generation;
  const offlineBefore = offlineAnswers;
  return reads
    .get(`${workspace}:${path}:${options?.timeoutMs ?? 45000}`, () => request<T>(path, options))
    .then((value) => {
      if (ttl !== null && generation === cache.generation && offlineAnswers === offlineBefore) {
        cache.set(cacheKey, path, value, ttl);
      }
      return value;
    });
}

export const httpClient = {
  get: <T>(path: string, options?: Pick<Options, 'timeoutMs' | 'workspaceId'>) => read<T>(path, options),
  post: <T>(path: string, body?: unknown) => mutate<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => mutate<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown) => mutate<T>(path, { method: 'PUT', body }),
  delete: <T>(path: string, body?: unknown) => mutate<T>(path, { method: 'DELETE', body }),
};

export type HttpClient = typeof httpClient;

// A board can read and mutate its workspace without changing the tab's selection.
export function workspaceHttpClient(workspaceId: string): HttpClient {
  return {
    get: <T>(path: string, options?: Pick<Options, 'timeoutMs' | 'workspaceId'>) =>
      httpClient.get<T>(path, { ...options, workspaceId }),
    post: <T>(path: string, body?: unknown) => mutate<T>(path, { method: 'POST', body, workspaceId }),
    patch: <T>(path: string, body?: unknown) => mutate<T>(path, { method: 'PATCH', body, workspaceId }),
    put: <T>(path: string, body?: unknown) => mutate<T>(path, { method: 'PUT', body, workspaceId }),
    delete: <T>(path: string, body?: unknown) => mutate<T>(path, { method: 'DELETE', body, workspaceId }),
  };
}
