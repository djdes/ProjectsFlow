import { useMemo, useSyncExternalStore } from 'react';
import type { LiveRepository } from '@/application/live/LiveRepository';
import { useContainer } from '@/infrastructure/di/container';
import { useCurrentUser } from './useCurrentUser';
import { LIVE_CHANGED_EVENT, REALTIME_CONNECTED_EVENT } from './useNotificationStream';

function activityStore(repository: LiveRepository, projectId: string) {
  let snapshot: ReadonlySet<string> | undefined;
  const listeners = new Set<() => void>();
  let revision = 0;
  let timer: number | undefined;
  const publish = (next: ReadonlySet<string>): void => { snapshot = next; for (const listener of listeners) listener(); };
  const refresh = (): void => {
    const request = ++revision;
    void repository.listRunningTaskIds(projectId).then(ids => {
      if (listeners.size > 0 && request === revision) publish(new Set(ids));
    }).catch(() => { /* Keep the last confirmed activity until reconnect. */ });
  };
  const onLive = (event: Event): void => {
    const detail = (event as CustomEvent<{ projectId?: string; taskId?: string; status?: string }>).detail;
    if (detail?.projectId !== projectId || !detail.taskId) return;
    ++revision;
    const next = new Set(snapshot);
    if (detail.status === 'running') next.add(detail.taskId); else next.delete(detail.taskId);
    publish(next);
    refresh();
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1) {
        refresh();
        timer = window.setInterval(refresh, 15000);
        window.addEventListener(LIVE_CHANGED_EVENT, onLive);
        window.addEventListener(REALTIME_CONNECTED_EVENT, refresh);
        window.addEventListener('focus', refresh);
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          ++revision;
          snapshot = undefined;
          window.clearInterval(timer);
          window.removeEventListener(LIVE_CHANGED_EVENT, onLive);
          window.removeEventListener(REALTIME_CONNECTED_EVENT, refresh);
          window.removeEventListener('focus', refresh);
        }
      };
    },
  };
}

// One snapshot/request per project and account, shared by every visible card.
const stores = new WeakMap<LiveRepository, Map<string, ReturnType<typeof activityStore>>>();
export function useWorkerActivity(projectId: string, taskId: string): boolean | undefined {
  const { liveRepository } = useContainer();
  const { user } = useCurrentUser();
  const store = useMemo(() => {
    let byProject = stores.get(liveRepository);
    if (!byProject) { byProject = new Map(); stores.set(liveRepository, byProject); }
    const key = `${user?.id ?? ''}:${projectId}`;
    let entry = byProject.get(key);
    if (!entry) { entry = activityStore(liveRepository, projectId); byProject.set(key, entry); }
    return entry;
  }, [liveRepository, projectId, user?.id]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return snapshot?.has(taskId);
}
