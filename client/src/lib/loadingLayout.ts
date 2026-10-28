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

/**
 * Heights of data-dependent blocks from the last visit (layout metadata only, never
 * content): the people row of the inbox, the project header (plates, cover, title,
 * description) and its plates. `<name>-m` below 768px, `<name>-d` from 768px.
 */
const SKELETON_SIZES_KEY = 'pf:skeleton-sizes';
type SavedSizes = Record<string, Record<string, number>>;

/** Exposes the remembered heights for `path` as `--pf-skel-<name>-<m|d>` on <html>. */
export function applySkeletonSizes(path: string): void {
  try {
    const saved = JSON.parse(
      localStorage.getItem('pf:skeleton-sizes') ?? '{}',
    ) as SavedSizes;
    const project = /^\/projects\/([^/]+)/.exec(path);
    const sizes = {
      ...saved.inbox,
      ...(project ? saved[`project:${project[1]}`] : null),
    } as Record<string, number>;
    const style = document.documentElement.style;
    for (const name of ['inbox-head', 'project-head', 'project-banners'])
      for (const bp of ['m', 'd']) {
        const value = sizes[`${name}-${bp}`];
        if (value > 0) style.setProperty(`--pf-skel-${name}-${bp}`, `${value}px`);
        else style.removeProperty(`--pf-skel-${name}-${bp}`);
      }
  } catch {
    /* Storage is optional: skeletons fall back to their natural height. */
  }
}

const skeletonBreakpoint = (): 'm' | 'd' =>
  matchMedia('(min-width: 768px)').matches ? 'd' : 'm';

export function rememberedSkeletonSize(scope: string, name: string): number | null {
  try {
    const saved = JSON.parse(localStorage.getItem(SKELETON_SIZES_KEY) ?? '{}') as SavedSizes;
    return saved[scope]?.[`${name}-${skeletonBreakpoint()}`] ?? null;
  } catch {
    return null;
  }
}

/** Projects keep their own sizes; only the most recently seen ones are kept. */
export function rememberSkeletonSize(scope: string, name: string, height: number): void {
  try {
    const saved = JSON.parse(localStorage.getItem(SKELETON_SIZES_KEY) ?? '{}') as SavedSizes;
    const key = `${name}-${skeletonBreakpoint()}`;
    const value = Math.round(height * 100) / 100;
    if (saved[scope]?.[key] === value) return;
    const entry = { ...saved[scope], [key]: value };
    delete saved[scope];
    saved[scope] = entry;
    const projects = Object.keys(saved).filter((k) => k.startsWith('project:'));
    for (const old of projects.slice(0, Math.max(0, projects.length - 30))) delete saved[old];
    localStorage.setItem(SKELETON_SIZES_KEY, JSON.stringify(saved));
  } catch {
    /* Storage is optional. */
  }
}
