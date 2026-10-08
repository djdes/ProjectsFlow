import { lazy, type ComponentType } from 'react';
import { loadModule } from '@/lib/loadModule';

const modules = new Map<string, () => Promise<unknown>>();
const listeners = new Set<() => void>();
let pending = 0;
export const subscribePageLoad = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const getPendingPageLoads = (): number => pending;
// React invokes lazy loaders while rendering. Notify mounted subscribers after that render.
const notify = (): void => {
  queueMicrotask(() => {
    for (const listener of listeners) listener();
  });
};

export function lazyPage<M extends Record<string, unknown>>(
  loader: () => Promise<M>,
  key: keyof M,
): ComponentType {
  let promise: Promise<{ default: ComponentType }> | undefined;
  const load = () =>
    (promise ??= loadModule(loader)
      .then((module) => ({ default: module[key] as ComponentType }))
      .catch((error) => {
        promise = undefined;
        throw error;
      }));
  modules.set(String(key), load);
  return lazy(() => {
    pending += 1;
    notify();
    return load()
      .catch((error) => {
        window.dispatchEvent(new Event('pf:page-load-error'));
        throw error;
      })
      .finally(() => {
        pending -= 1;
        notify();
      });
  });
}

const destinations: Array<[RegExp, string]> = [
  [/^\/$/, 'InboxPage'],
  [/^\/ai(?:\/|$)/, 'AiPage'],
  [/^\/profile(?:\/|$)/, 'ProfilePage'],
  [/^\/projects\/[^/]+\/?$/, 'TasksPage'],
  [/^\/projects\/[^/]+\/overview$/, 'ProjectPage'],
  [/^\/projects\/[^/]+\/kb$/, 'KbPage'],
  [/^\/projects\/[^/]+\/studio/, 'ProjectStudioPage'],
  [/^\/projects\/[^/]+\/tasks\/[^/]+$/, 'TaskDetailPage'],
  [/^\/projects\/[^/]+\/finance$/, 'FinancePage'],
  [/^\/projects\/[^/]+\/monitoring$/, 'MonitoringPage'],
  [/^\/workspaces\/[^/]+\/settings$/, 'WorkspaceSettingsPage'],
];

/** Import code only, never user data. Failed speculative imports can be retried. */
export function preloadPage(href: string): void {
  const connection = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }
  ).connection;
  if (
    connection?.saveData ||
    /(^|-)2g$/.test(connection?.effectiveType ?? '') ||
    !navigator.onLine
  )
    return;
  try {
    const url = new URL(href, location.href);
    if (url.origin !== location.origin) return;
    const name = destinations.find(([pattern]) =>
      pattern.test(url.pathname),
    )?.[1];
    if (name)
      void modules
        .get(name)?.()
        .catch(() => {
          /* Navigation retries the import. */
        });
  } catch {
    /* Non-route links are not preloaded. */
  }
}
