import { useEffect } from 'react';
import { REALTIME_CONNECTED_EVENT, TASK_CHANGED_EVENT } from './useNotificationStream';

/** Debounce Inbox snapshots without losing events inside a recent refresh window. */
export function useInboxRealtimeRefresh(
  refresh: () => void,
  lastRefreshAt: Readonly<{ current: number }>,
): void {
  useEffect(() => {
    let timer: number | undefined;
    // Set while waiting to see if our own tab's mutation handler refreshes locally; cleared on any
    // non-ownTab event so colleague/bot/reconnect updates are never dropped.
    let pendingOwnTabAt: number | null = null;
    const run = (): void => {
      if (pendingOwnTabAt !== null && lastRefreshAt.current >= pendingOwnTabAt - 500) {
        pendingOwnTabAt = null;
        timer = undefined;
        return;
      }
      const remaining = 400 - (Date.now() - lastRefreshAt.current);
      if (remaining > 0) {
        timer = window.setTimeout(run, remaining);
        return;
      }
      pendingOwnTabAt = null;
      timer = undefined;
      refresh();
    };
    const schedule = (event: Event): void => {
      // Skip our own tab's immediate SSE echo when we already refreshed locally (or refresh right
      // after the HTTP mutation response arrives). Other widgets in this tab that didn't call
      // `refresh()` still get picked up once the 250ms debounce fires.
      const detail = (event as CustomEvent<{ ownTab?: unknown }>).detail;
      if (event.type === TASK_CHANGED_EVENT && detail?.ownTab === true) {
        const now = Date.now();
        if (now - lastRefreshAt.current < 1000 && timer === undefined) return;
        if (timer === undefined) pendingOwnTabAt = now;
      } else {
        pendingOwnTabAt = null;
      }
      window.clearTimeout(timer);
      timer = window.setTimeout(run, 250);
    };
    window.addEventListener(TASK_CHANGED_EVENT, schedule);
    window.addEventListener(REALTIME_CONNECTED_EVENT, schedule);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(TASK_CHANGED_EVENT, schedule);
      window.removeEventListener(REALTIME_CONNECTED_EVENT, schedule);
    };
  }, [refresh, lastRefreshAt]);
}