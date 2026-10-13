import { useEffect } from 'react';
import { REALTIME_CONNECTED_EVENT, TASK_CHANGED_EVENT } from './useNotificationStream';

/** Debounce Inbox snapshots without losing events inside a recent refresh window. */
export function useInboxRealtimeRefresh(
  refresh: () => void,
  lastRefreshAt: Readonly<{ current: number }>,
): void {
  useEffect(() => {
    let timer: number | undefined;
    const run = (): void => {
      const remaining = 400 - (Date.now() - lastRefreshAt.current);
      if (remaining > 0) {
        timer = window.setTimeout(run, remaining);
        return;
      }
      timer = undefined;
      refresh();
    };
    const schedule = (): void => {
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