// «Пришли свежие данные». Кеш чтений (infrastructure/http/ReadCache) отдал экрану сохранённый
// ответ, сразу — без скелетона, а в фоне получил новый, и он отличается. Экраны, которые
// читают с разрешением на сохранённый ответ (httpClient `swr`), подписываются и перечитывают:
// теперь уже из памяти, без запроса. Событие без путей — экранам не нужно знать адреса API.
// Пачку обновлений подряд (несколько фоновых ответов) сводим в одно событие.

export const READ_REFRESHED_EVENT = 'pf:read-refreshed';
// Обратное направление: пользователь просит актуальное (жест «потянуть вниз»). Кеш чтений
// перестаёт считать известное свежим, и экраны, перечитывая, идут в сеть.
export const REFRESH_REQUESTED_EVENT = 'pf:refresh-requested';

const COALESCE_MS = 40;
let pending: ReturnType<typeof setTimeout> | null = null;

export function announceReadRefreshed(): void {
  if (typeof window === 'undefined' || pending !== null) return;
  pending = setTimeout(() => {
    pending = null;
    window.dispatchEvent(new Event(READ_REFRESHED_EVENT));
  }, COALESCE_MS);
}

export function onReadRefreshed(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(READ_REFRESHED_EVENT, callback);
  return () => window.removeEventListener(READ_REFRESHED_EVENT, callback);
}
