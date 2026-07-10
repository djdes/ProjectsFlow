// Единое место разбора «куда вернуть юзера после логина» (U1/UP1). Источник цели —
// query-параметр `?next=` (в т.ч. абсолютный URL при возврате с поддомена доски на
// апекс-приложение) или react-router `state.from`. Открытый редирект закрыт: пускаем
// только относительные пути и абсолютные URL на наши же домены.

const BASE_DOMAIN = 'projectsflow.ru';

function isAllowedHost(host: string): boolean {
  const h = host.split(':')[0];
  return (
    h === BASE_DOMAIN ||
    h.endsWith(`.${BASE_DOMAIN}`) ||
    h === 'localhost' ||
    h === '127.0.0.1'
  );
}

// Валидирует и нормализует `next`. Возвращает безопасную цель (относительный путь или
// абсолютный URL на разрешённый домен) либо null, если значение небезопасно/пустое.
export function safeNextTarget(next: string | null | undefined): string | null {
  if (!next) return null;
  // Относительный путь (но не protocol-relative `//evil.com`).
  if (next.startsWith('/') && !next.startsWith('//')) return next;
  try {
    const url = new URL(next);
    if ((url.protocol === 'https:' || url.protocol === 'http:') && isAllowedHost(url.host)) {
      return url.toString();
    }
  } catch {
    // не URL — считаем небезопасным
  }
  return null;
}

export function isAbsoluteUrl(target: string): boolean {
  return /^https?:\/\//i.test(target);
}

// Выполняет переход на цель: cross-origin (абсолютный) — через window.location, чтобы
// уйти на другой домен; относительный — через переданный navigate (react-router).
export function goToPostAuthTarget(
  target: string,
  navigate: (to: string, opts?: { replace?: boolean }) => void,
): void {
  if (isAbsoluteUrl(target)) {
    window.location.assign(target);
    return;
  }
  navigate(target, { replace: true });
}
