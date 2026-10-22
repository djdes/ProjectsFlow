import { useEffect, useRef, useState } from 'react';
import { useContainer } from '@/infrastructure/di/container';
import type { TaskLiveRun } from '@/domain/live/TaskLiveTimeline';
import type { LiveEvent } from '@/domain/live/LiveEvent';
import type { LiveSessionStatus } from '@/domain/live/LiveSession';
import { LIVE_CHANGED_EVENT, REALTIME_CONNECTED_EVENT } from './useNotificationStream';

function mergeEvents(previous: LiveEvent[], incoming: LiveEvent[]): LiveEvent[] {
  const bySeq = new Map(previous.map(event => [event.seq, event]));
  for (const event of incoming) bySeq.set(event.seq, event);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

export function useTaskLiveTimeline(projectId: string, taskId: string): {
  runs: TaskLiveRun[]; loading: boolean; error: string | null;
} {
  const { liveRepository } = useContainer();
  const cache = useRef(new Map<string, TaskLiveRun>());
  const [runs, setRuns] = useState<TaskLiveRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refreshRef = useRef<() => void>(() => {});

  useEffect(() => {
    let disposed = false;
    let fetching = false;
    let refreshAgain = false;
    cache.current = new Map();
    setRuns([]);
    setLoading(true);
    const publish = (): void => {
      if (!disposed) setRuns([...cache.current.values()].sort((a, b) => a.session.startedAt.getTime() - b.session.startedAt.getTime()));
    };
    const refresh = async (): Promise<void> => {
      if (disposed) return;
      if (fetching) { refreshAgain = true; return; }
      fetching = true;
      try {
        const sessions = await liveRepository.listSessions(projectId, taskId);
        if (disposed) return;
        // Preserve already rendered history while the next run is starting.
        for (const session of sessions) {
          const previous = cache.current.get(session.id);
          if (previous && previous.session.lastSeq >= session.lastSeq && previous.session.status === session.status) continue;
          let events: LiveEvent[] = [];
          let afterSeq = previous?.events.at(-1)?.seq ?? 0;
          for (;;) {
            const page = await liveRepository.listEvents(projectId, taskId, session.id, afterSeq, 1000);
            if (disposed) return;
            if (page.length === 0) break;
            const next = Math.max(...page.map(event => event.seq));
            if (next <= afterSeq) break;
            events = events.concat(page);
            afterSeq = next;
            if (page.length < 1000 || afterSeq >= session.lastSeq) break;
          }
          let fileDiffs = previous?.fileDiffs ?? [];
          if (session.status !== 'running' && (!previous || previous.session.status === 'running')) {
            try { fileDiffs = await liveRepository.listFileDiffs(projectId, taskId, session.id); } catch { /* Optional details. */ }
          }
          if (disposed) return;
          // SSE may have appended while the REST page was in flight.
          cache.current.set(session.id, { session, events: mergeEvents(cache.current.get(session.id)?.events ?? [], events), fileDiffs });
        }
        const ids = new Set(sessions.map(session => session.id));
        for (const id of cache.current.keys()) if (!ids.has(id)) cache.current.delete(id);
        publish();
        setError(null);
      } catch {
        if (!disposed) setError('Не удалось обновить ленту. Повторяем подключение…');
      } finally {
        fetching = false;
        if (!disposed) {
          setLoading(false);
          if (refreshAgain) { refreshAgain = false; void refresh(); }
        }
      }
    };
    refreshRef.current = () => void refresh();
    const onChanged = (event: Event): void => {
      const detail = (event as CustomEvent<{ projectId?: string; taskId?: string }>).detail;
      if (event.type === LIVE_CHANGED_EVENT && (detail?.projectId !== projectId || detail.taskId !== taskId)) return;
      void refresh();
    };
    void refresh();
    // Also discovers a new run if its lifecycle event was missed during reconnect.
    const timer = window.setInterval(() => void refresh(), 5000);
    window.addEventListener(LIVE_CHANGED_EVENT, onChanged);
    window.addEventListener(REALTIME_CONNECTED_EVENT, onChanged);
    window.addEventListener('focus', onChanged);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener(LIVE_CHANGED_EVENT, onChanged);
      window.removeEventListener(REALTIME_CONNECTED_EVENT, onChanged);
      window.removeEventListener('focus', onChanged);
    };
  }, [projectId, taskId, liveRepository]);

  const runningId = runs.findLast(run => run.session.status === 'running')?.session.id ?? null;
  useEffect(() => {
    if (!runningId) return;
    let disposed = false;
    let source: EventSource | null = null;
    let retry: number | undefined;
    const open = (): void => {
      if (disposed) return;
      const afterSeq = cache.current.get(runningId)?.events.at(-1)?.seq ?? 0;
      source = new EventSource(`/api/projects/${projectId}/tasks/${taskId}/live/sessions/${runningId}/stream?afterSeq=${afterSeq}`, { withCredentials: true });
      source.addEventListener('live', event => {
        if (disposed) return;
        try {
          const dto = JSON.parse((event as MessageEvent).data) as Omit<LiveEvent, 'createdAt'> & { createdAt: string };
          const run = cache.current.get(runningId);
          if (!run) return;
          cache.current.set(runningId, { ...run, events: mergeEvents(run.events, [{ ...dto, createdAt: new Date(dto.createdAt) }]) });
          setRuns([...cache.current.values()].sort((a, b) => a.session.startedAt.getTime() - b.session.startedAt.getTime()));
        } catch { /* Malformed event: the next REST refresh recovers the tail. */ }
      });
      source.addEventListener('live_end', event => {
        if (disposed) return;
        let status: LiveSessionStatus = 'completed';
        try { status = JSON.parse((event as MessageEvent).data).status ?? status; } catch { /* Refresh below. */ }
        const run = cache.current.get(runningId);
        if (run) setRuns(current => current.map(item => item.session.id === runningId ? { ...item, session: { ...item.session, status } } : item));
        source?.close();
        refreshRef.current();
      });
      source.onerror = () => {
        source?.close();
        if (!disposed) retry = window.setTimeout(open, 1500);
      };
    };
    open();
    return () => { disposed = true; source?.close(); window.clearTimeout(retry); };
  }, [projectId, taskId, runningId]);
  return { runs, loading, error };
}
