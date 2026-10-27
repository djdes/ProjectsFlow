export type LoadingLayout =
  | 'board'
  | 'table'
  | 'list'
  | 'calendar'
  | 'inbox'
  | 'settings'
  | 'overview'
  | 'document'
  | 'chat'
  | 'studio'
  | 'dashboard'
  | 'task'
  | 'auth';

/** Only layout metadata is stored; never project names or task contents. */
export function projectLoadingLayout(
  projectId: string,
  viewId?: string | null,
): LoadingLayout {
  try {
    const selected =
      viewId ?? localStorage.getItem(`pf:board-view:${projectId}`);
    const layouts = JSON.parse(
      localStorage.getItem(`pf:view-layouts:${projectId}`) ?? '{}',
    ) as Record<string, unknown>;
    const type = selected ? layouts?.[selected] : null;
    if (type === 'table' || type === 'list' || type === 'calendar') return type;
  } catch {
    /* Storage is optional, an ordinary board silhouette is safe. */
  }
  return 'board';
}

/** The URL is available before either the page chunk or its data. */
export function loadingLayoutForPath(path: string): LoadingLayout {
  if (
    /^\/(login|register|forgot-password|reset-password|invite|device|duplicate)(\/|$)/.test(
      path,
    )
  )
    return 'auth';
  if (path === '/' || path === '/inbox') return 'inbox';
  if (
    /\/tasks\/[^/]+$/.test(path) ||
    /^\/t\//.test(path) ||
    /\/t\/[^/]+$/.test(path)
  )
    return 'task';
  if (/\/studio$/.test(path)) return 'studio';
  if (/^\/ai(\/|$)/.test(path)) return 'chat';
  if (/\/kb$/.test(path)) return 'document';
  if (/\/(settings|profile)$/.test(path)) return 'settings';
  if (/\/overview$/.test(path)) return 'overview';
  if (/\/(monitoring|alerts|finance|admin)(\/|$)/.test(path))
    return 'dashboard';
  return 'board';
}

/** The skeleton of a route; the pre-React boot screen uses the same rule. */
export function routeLoadingLayout(path: string, search = ''): LoadingLayout {
  const project = /^\/projects\/([^/]+)\/?$/.exec(path);
  return project
    ? projectLoadingLayout(project[1], new URLSearchParams(search).get('view'))
    : loadingLayoutForPath(path);
}

/**
 * Boot screen variant: `shell:<layout>` inside the app shell, `page:<layout>` for routes
 * without it (sign-in, public boards, device confirmation). The functions in this module
 * are inlined into index.html, so they must not use imports or outer variables.
 */
export function bootSkeletonKey(path: string, search: string, host: string): string {
  const layout = routeLoadingLayout(path, search);
  const publicBoard =
    /^\/p\//.test(path) ||
    (/\.projectsflow\.ru$/.test(host.split(':')[0]) &&
      !/^(www|api|app)\./.test(host));
  const bare = layout === 'auth' || publicBoard || /^\/device(\/|$)/.test(path);
  return `${bare ? 'page' : 'shell'}:${bare && publicBoard ? 'board' : layout}`;
}

/** InstallAppPrompt shows its banner under the mobile header: not installed, not dismissed. */
export function installBannerExpected(): boolean {
  try {
    const standalone =
      matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    return !standalone && localStorage.getItem('pf-install-dismissed') !== '1';
  } catch {
    return false;
  }
}
