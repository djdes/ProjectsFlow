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
    if (res.status === 401) {
      try {
        window.dispatchEvent(new CustomEvent('pf:session-expired'));
      } catch {
        // не-браузерное окружение — событие некому слушать, игнорируем.
      }
    }
    const body = (data as HttpErrorBody | null) ?? { error: 'unknown_error' };
    throw new HttpError(res.status, body);
  }

  return data as T;
}

export const httpClient = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
