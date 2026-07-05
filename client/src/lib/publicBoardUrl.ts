// Единственное место сборки публичного URL доски на клиенте. Развязывает идентификатор
// (public_slug) и форму URL (path сейчас — /p/<slug>). При переходе на сабдомен позже
// меняется только эта функция. См. spec db/096.

// Полный URL для «Copy link» / открытия сайта (с протоколом и origin).
export function publicBoardUrl(slug: string, origin: string = window.location.origin): string {
  return `${origin.replace(/\/+$/, '')}/p/${slug}`;
}

// Короткая форма для показа в окне Publish (без протокола): projectsflow.ru/p/<slug>.
export function publicBoardDisplayUrl(slug: string, host: string = window.location.host): string {
  return `${host}/p/${slug}`;
}
