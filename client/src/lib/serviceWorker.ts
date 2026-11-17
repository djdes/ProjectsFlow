// The app service worker (public/sw.js): push notifications and offline start.
// main.tsx registers it in production builds only.

// A push notification was tapped while the app is open: the service worker asks to open a link.
// The listener inside the router (useServiceWorkerNavigation) cancels the event (preventDefault)
// and navigates itself, without a reload and with a workspace switch. Without a listener (sign-in
// screen, still loading) it is a plain page navigation.
export const SW_OPEN_URL_EVENT = 'pf:sw-open-url';

export type SwOpenUrlDetail = {
  readonly url: string;
  readonly workspaceId: string | null;
};

// Same-origin paths only.
export function sameOriginPath(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return null;
  try {
    const url = new URL(value, window.location.origin);
    return url.origin === window.location.origin ? url.pathname + url.search + url.hash : null;
  } catch {
    return null;
  }
}

function onMessage(event: MessageEvent): void {
  const data = event.data as { type?: unknown; url?: unknown; workspaceId?: unknown } | null;
  if (!data || data.type !== 'pf:open-url') return;
  const url = sameOriginPath(data.url);
  if (!url) return;
  const detail: SwOpenUrlDetail = { url, workspaceId: typeof data.workspaceId === 'string' ? data.workspaceId : null };
  const handled = !window.dispatchEvent(new CustomEvent<SwOpenUrlDetail>(SW_OPEN_URL_EVENT, { detail, cancelable: true }));
  if (!handled) window.location.assign(url);
  event.ports[0]?.postMessage({ type: 'pf:open-url:done' });
}

function saveData(): boolean {
  return (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
}

export function registerServiceWorker(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', onMessage);
  const register = (): void => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then(async () => {
        if (saveData()) return;
        const registration = await navigator.serviceWorker.ready;
        registration.active?.postMessage({ type: 'pf:warm-cache' });
      })
      .catch((error: unknown) => {
        console.warn('[pwa] service worker registration failed', error);
      });
  };
  // After the page load, so installing never competes with the first start for the network.
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
