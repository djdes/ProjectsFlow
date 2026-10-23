import { useMemo, useSyncExternalStore } from 'react';
import type { LiveRepository } from '@/application/live/LiveRepository';
import type { TaskWorkerActivity } from '@/domain/live/TaskWorkerActivity';
import { useContainer } from '@/infrastructure/di/container';
import { useCurrentUser } from './useCurrentUser';
import { LIVE_CHANGED_EVENT, REALTIME_CONNECTED_EVENT, TASK_CHANGED_EVENT } from './useNotificationStream';

function activityStore(repository: LiveRepository, projectId: string) {
  let snapshot: ReadonlyMap<string, TaskWorkerActivity> | undefined;
  const listeners = new Set<() => void>();
  let revision = 0;
  let timer: number | undefined;
  const publish = (next: ReadonlyMap<string, TaskWorkerActivity>): void => { snapshot = next; for (const listener of listeners) listener(); };
  const refresh = (): void => {
    const request = ++revision;
    void repository.listTaskActivity(projectId).then(rows => {
      if (listeners.size > 0 && request === revision) publish(new Map(rows.map(row => [row.taskId, row])));
    }).catch(() => { /* Keep the last confirmed activity until reconnect. */ });
  };
  const onLive = (event: Event): void => {
    const detail = (event as CustomEvent<{ projectId?: string; taskId?: string; status?: string }>).detail;
    if (detail?.projectId !== projectId || !detail.taskId) return;
    ++revision;
    const next = new Map(snapshot);
    if (detail.status === 'running') next.set(detail.taskId, { taskId: detail.taskId, state: 'running', sessionId: null, questionCommentId: null });
    else if (detail.status === 'failed' || detail.status === 'timeout') next.set(detail.taskId, { taskId: detail.taskId, state: 'error', sessionId: null, questionCommentId: null });
    else next.delete(detail.taskId);
    publish(next);
    refresh();
  };
  const onTaskChanged = (event: Event): void => {
    if ((event as CustomEvent<{ projectId?: string }>).detail?.projectId === projectId) refresh();
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1) {
        refresh();
        timer = window.setInterval(refresh, 15000);
        window.addEventListener(LIVE_CHANGED_EVENT, onLive);
        window.addEventListener(TASK_CHANGED_EVENT, onTaskChanged);
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
          window.removeEventListener(TASK_CHANGED_EVENT, onTaskChanged);
          window.removeEventListener(REALTIME_CONNECTED_EVENT, refresh);
          window.removeEventListener('focus', refresh);
        }
      };
    },
  };
}

// One snapshot/request per project and account, shared by every visible card.
const stores = new WeakMap<LiveRepository, Map<string, ReturnType<typeof activityStore>>>();
export function useTaskWorkerActivity(projectId: string, taskId: string): TaskWorkerActivity | null | undefined {
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
  return snapshot === undefined ? undefined : snapshot.get(taskId) ?? null;
}

export function useWorkerActivity(projectId: string, taskId: string): boolean | undefined {
  const activity = useTaskWorkerActivity(projectId, taskId);
  return activity === undefined ? undefined : activity?.state === 'running';
}
