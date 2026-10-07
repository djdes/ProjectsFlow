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
