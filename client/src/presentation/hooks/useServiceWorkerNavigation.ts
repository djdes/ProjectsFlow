import { useEffect, useRef } from 'react';
import { SW_OPEN_URL_EVENT, type SwOpenUrlDetail } from '@/lib/serviceWorker';

// A push notification tapped while the app is open: navigate inside the app (no reload). open is
// the same function that opens toasts: it switches to the notification's workspace first, then
// follows the link.
export function useServiceWorkerNavigation(open: (url: string, workspaceId: string | null) => void | Promise<void>): void {
  const openRef = useRef(open);
  useEffect(() => { openRef.current = open; }, [open]);
  useEffect(() => {
    const onOpen = (event: Event): void => {
      const { url, workspaceId } = (event as CustomEvent<SwOpenUrlDetail>).detail;
      event.preventDefault();
      void Promise.resolve(openRef.current(url, workspaceId)).catch(() => window.location.assign(url));
    };
    window.addEventListener(SW_OPEN_URL_EVENT, onOpen);
    return () => window.removeEventListener(SW_OPEN_URL_EVENT, onOpen);
  }, []);
}
