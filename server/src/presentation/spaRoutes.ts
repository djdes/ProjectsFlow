// Known SPA paths of client/src/presentation/app/routes.tsx.
//
// The SPA fallback used to answer 200 for ANY path, so a typo or a dead link
// (/no-such-page, /favicon-old.png, /wp-login.php) looked like a real page to
// search engines: a "soft 404". Now an unknown path still gets the same SPA
// shell (the user sees the app's NotFoundPage), but with status 404 and
// X-Robots-Tag: noindex.
//
// Keep in sync with routes.tsx — spaRoutes.test.ts reads that file and fails
// when a client route is missing here. A missing entry is not fatal for users
// (the body is the same SPA), it only changes the status code.

const BASE_DOMAIN = 'projectsflow.ru';
const RESERVED_SUB = new Set(['www', 'api', 'app']);

const SEG = '[^/]+';

const KNOWN: readonly RegExp[] = [
  '/',
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/duplicate',
  `/invite/${SEG}`,
  `/p/${SEG}`,
  `/p/${SEG}/t/${SEG}`,
  '/device',
  '/all-tasks',
  '/ai',
  `/ai/c/${SEG}`,
  '/inbox',
  '/notifications',
  '/monitoring',
  '/monitoring/alerts',
  `/projects/${SEG}`,
  `/projects/${SEG}/(studio|overview|kb|monitoring|finance|tasks)`,
  `/projects/${SEG}/tasks/${SEG}`,
  '/profile',
  '/share',
  '/desktop-notes',
  `/workspaces/${SEG}/settings`,
  '/admin',
].map((p) => new RegExp(`^${p}/?$`));

/** True when the path is a route the SPA renders (not its catch-all NotFoundPage). */
export function isKnownSpaPath(path: string): boolean {
  return KNOWN.some((re) => re.test(path));
}

/**
 * <slug>.projectsflow.ru is a public board: there the whole SPA is the board and
 * every path is valid (routes.tsx, boardHostSlug). Mirrors client boardSlugFromHost.
 */
export function isBoardHost(host: string | undefined): boolean {
  const hostname = (host ?? '').split(':')[0]!.toLowerCase();
  if (hostname === BASE_DOMAIN || !hostname.endsWith(`.${BASE_DOMAIN}`)) return false;
  const label = hostname.slice(0, hostname.length - BASE_DOMAIN.length - 1);
  return Boolean(label) && !label.includes('.') && !RESERVED_SUB.has(label);
}

/** Should the SPA fallback answer this request with 404 (same body, noindex)? */
export function isSpaNotFound(path: string, host: string | undefined): boolean {
  return !isBoardHost(host) && !isKnownSpaPath(path);
}
