// «Пришли свежие данные». Кеш чтений (infrastructure/http/ReadCache) отдал экрану сохранённый
// ответ, сразу — без скелетона, а в фоне получил новый, и он отличается. Экраны, которые
// читают с разрешением на сохранённый ответ (httpClient `swr`), подписываются и перечитывают:
// теперь уже из памяти, без запроса. Экраны подписываются по смысловым темам (без адресов API).
// Пачку обновлений подряд (несколько фоновых ответов) сводим в одно событие.

export const READ_REFRESHED_EVENT = 'pf:read-refreshed';
// Обратное направление: пользователь просит актуальное (жест «потянуть вниз»). Кеш чтений
// перестаёт считать известное свежим, и экраны, перечитывая, идут в сеть.
export const REFRESH_REQUESTED_EVENT = 'pf:refresh-requested';

export type ReadRefreshTopic = 'inbox' | 'projects' | 'tasks' | 'members' | 'other';

const COALESCE_MS = 40;
let pending: ReturnType<typeof setTimeout> | null = null;
let pendingTopics: Set<ReadRefreshTopic> | null = new Set();

export function announceReadRefreshed(topic?: ReadRefreshTopic): void {
  if (typeof window === 'undefined') return;
  if (topic === undefined) pendingTopics = null;
  else if (pendingTopics !== null) pendingTopics.add(topic);
  if (pending !== null) return;
  pending = setTimeout(() => {
    const topics = pendingTopics ? [...pendingTopics] : null;
    pending = null;
    pendingTopics = new Set();
    window.dispatchEvent(
      topics
        ? new CustomEvent<{ topics: readonly ReadRefreshTopic[] }>(READ_REFRESHED_EVENT, {
            detail: { topics },
          })
        : new Event(READ_REFRESHED_EVENT),
    );
  }, COALESCE_MS);
}

export function onReadRefreshed(
  callback: () => void,
  topics?: readonly ReadRefreshTopic[],
): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const listener = (event: Event): void => {
    if (topics && topics.length > 0) {
      const detail = (event as CustomEvent<{ topics?: readonly ReadRefreshTopic[] }>).detail;
      // Plain Event without topics (e.g. legacy callers/tests) wakes every subscriber.
      if (detail?.topics && !detail.topics.some((t) => topics.includes(t))) return;
    }
    callback();
  };
  window.addEventListener(READ_REFRESHED_EVENT, listener);
  return () => window.removeEventListener(READ_REFRESHED_EVENT, listener);
}
