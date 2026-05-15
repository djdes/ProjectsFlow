// Тонкая обёртка над fetch. Базовый URL — относительный /api,
// потому что Vite-dev-proxy + продовая сборка (same-origin) обе работают так.
// `credentials: 'include'` — обязательно для cookie-сессий.

import { HttpError, type HttpErrorBody } from '@/lib/HttpError';

// Re-export для удобства infrastructure-слоя; presentation должен импортировать из '@/lib/HttpError'.
export { HttpError };
export type { HttpErrorBody };

type Options = {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  readonly body?: unknown;
};

async function request<T>(path: string, opts: Options = {}): Promise<T> {
  const init: RequestInit = {
    method: opts.method ?? 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  };

  if (opts.body !== undefined) {
    init.headers = { ...init.headers, 'Content-Type': 'application/json' };
    init.body = JSON.stringify(opts.body);
  }

  const res = await fetch(`/api${path}`, init);

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;

  if (!res.ok) {
    const body = (data as HttpErrorBody | null) ?? { error: 'unknown_error' };
    throw new HttpError(res.status, body);
  }

  return data as T;
}

export const httpClient = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
