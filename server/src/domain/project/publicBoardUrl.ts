// Единственное место сборки публичного URL доски на сервере. Развязывает идентификатор
// (public_slug в БД) и форму URL (path сейчас — /p/<slug>; при переходе на сабдомен позже
// меняется ТОЛЬКО эта функция + nginx, модель данных не трогается). См. spec db/096.
export function publicBoardUrl(appUrl: string, slug: string): string {
  const base = appUrl.replace(/\/+$/, '');
  return `${base}/p/${slug}`;
}
