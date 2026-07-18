import type { NextFunction, Request, Response } from 'express';

// Заголовки безопасности на все ответы (s-m4). Без зависимости от helmet — набор
// небольшой и стабильный. Главная цель — anti-clickjacking для app-origin и запрет
// MIME-sniffing. CSP держим консервативным: `frame-ancestors 'none'` (дублирует
// X-Frame-Options для современных браузеров), но НЕ ограничиваем script/style-src,
// чтобы не сломать инлайновый FOUC-скрипт в index.html и Tailwind-инлайн-стили.
export function securityHeaders(baseDomain = 'projectsflow.ru') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const hostname = req.hostname.toLowerCase();
    const isResultSubdomain = hostname.endsWith(`.${baseDomain}`)
      && hostname !== `www.${baseDomain}`
      && hostname !== `api.${baseDomain}`
      && hostname !== `app.${baseDomain}`;
    if (isResultSubdomain) {
      // Результат проекта можно встроить ТОЛЬКО в основной интерфейс ProjectsFlow. XFO
      // не умеет allowlist разных origin, поэтому на result-subdomain полагаемся на CSP.
      res.removeHeader('X-Frame-Options');
      res.setHeader(
        'Content-Security-Policy',
        `frame-ancestors https://${baseDomain} https://www.${baseDomain}`,
      );
    } else {
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  };
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// CSRF-митигация для cookie-авторизованных мутаций (S3). Публичные доски и
// задеплоенные воркером сайты живут на поддоменах `*.projectsflow.ru` — это тот же
// registrable-домен, т.е. `SameSite=Lax` пропускает сессионную куку на
// cross-subdomain POST (в т.ч. multipart, который идёт БЕЗ preflight). Проверяем
// `Sec-Fetch-Site`: доверенный SPA шлёт `same-origin`; недоверенный поддомен —
// `same-site`; сторонний сайт — `cross-site`.
//
// Проверку применяем ТОЛЬКО когда запрос авторизован сессионной кукой. Bearer-запросы
// (agent-API из MCP/.NET-диспетчера) куку не несут и не подвержены CSRF — их не трогаем,
// иначе не-браузерные клиенты (без Sec-Fetch-*) сломаются.
export function csrfOriginGuard(sessionCookieName: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }
    const hasSessionCookie = Boolean(req.cookies?.[sessionCookieName]);
    if (!hasSessionCookie) {
      // Bearer / opaque-token / аноним — не cookie-CSRF-поверхность.
      next();
      return;
    }
    const secFetchSite = req.headers['sec-fetch-site'];
    if (typeof secFetchSite === 'string') {
      // `same-origin` — наш SPA; `none` — top-level переход (адресная строка/клик из
      // письма), не программный CSRF. Всё остальное (`same-site`/`cross-site`) — блок.
      if (secFetchSite === 'same-origin' || secFetchSite === 'none') {
        next();
        return;
      }
      res
        .status(403)
        .json({ error: 'csrf_blocked', message: 'Запрос отклонён политикой безопасности' });
      return;
    }
    // Старый браузер без Sec-Fetch-* — fallback на Origin. Если Origin отсутствует
    // (тоже старые/native) — пропускаем (кука host-only, хвост таких клиентов мал).
    const origin = req.headers.origin;
    if (typeof origin !== 'string' || origin.length === 0) {
      next();
      return;
    }
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      res.status(403).json({ error: 'csrf_blocked' });
      return;
    }
    // Разрешаем только точное совпадение host с host запроса (наш app-origin).
    if (originHost === req.headers.host) {
      next();
      return;
    }
    res.status(403).json({ error: 'csrf_blocked', message: 'Запрос отклонён политикой безопасности' });
  };
}
