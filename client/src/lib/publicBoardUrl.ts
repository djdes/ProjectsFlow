// Публичная ссылка доски — Notion-style ПОДДОМЕН: https://<slug>.projectsflow.ru.
// Единое место сборки/разбора URL доски. Раньше был path (/p/<slug>) — он остаётся рабочим
// для старых ссылок (роут /p/:slug), но новые ссылки и «Copy link» — поддомен. См. db/096.

// Базовый домен платформы. Поддомены работают только в проде; в dev (localhost)
// boardSlugFromHost вернёт null (доска открывается по пути /p/<slug>).
const BASE_DOMAIN = 'projectsflow.ru';
const RESERVED_SUB = new Set(['www', 'api', 'app']);

// Полный URL доски (для «Copy link» / открытия).
export function publicBoardUrl(slug: string): string {
  return `https://${slug}.${BASE_DOMAIN}`;
}

// Короткая форма для показа в окне Publish (без протокола): <slug>.projectsflow.ru.
export function publicBoardDisplayUrl(slug: string): string {
  return `${slug}.${BASE_DOMAIN}`;
}

// Если текущий хост — поддомен доски (<slug>.projectsflow.ru), вернуть slug; иначе null
// (апекс-домен / www / api / dev-localhost). На поддомене клиент рендерит публичную доску.
export function boardSlugFromHost(host: string = window.location.host): string | null {
  const hostname = host.split(':')[0];
  if (hostname === BASE_DOMAIN || !hostname.endsWith(`.${BASE_DOMAIN}`)) return null;
  const label = hostname.slice(0, hostname.length - BASE_DOMAIN.length - 1);
  if (!label || label.includes('.') || RESERVED_SUB.has(label)) return null;
  return label;
}
