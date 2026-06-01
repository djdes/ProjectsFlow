import { useCallback, useEffect, useRef, useState } from 'react';
import { useContainer } from '@/infrastructure/di/container';
import type { LiveSession, LiveSessionStatus } from '@/domain/live/LiveSession';
import type { LiveEvent } from '@/domain/live/LiveEvent';
import type { LiveFileDiff } from '@/domain/live/LiveFileDiff';

type UseLiveSessionResult = {
  // События выбранной сессии (replay из БД + live-хвост из SSE), упорядочены по seq.
  readonly events: LiveEvent[];
  // Метаданные выбранной сессии.
  readonly session: LiveSession | null;
  // Полные git-диффы файлов (финал сессии).
  readonly fileDiffs: LiveFileDiff[];
  readonly loading: boolean;
  // Сессия активна (status==='running') — открыт SSE-стрим, показываем бейдж 🔴.
  readonly running: boolean;
  // Принудительная перезагрузка (replay) текущей сессии.
  readonly reload: () => void;
};

// Хук одной выбранной LIVE-сессии задачи:
//   1) REST replay событий (afterSeq=0) через LiveRepository,
//   2) EventSource на /stream?afterSeq=<lastSeq> (паттерн useNotificationStream:
//      EventSource напрямую, withCredentials, сам реконнектит),
//   3) append 'live'-событий, dedupe по seq, на 'live_end' закрываем стрим и
//      догружаем file-diffs.
// reconnect использует актуальный afterSeq (последний полученный seq) → без потерь/дублей.
// Cleanup закрывает EventSource на unmount / смене сессии.
//
// sessionId === null → хук в простое (нет открытой сессии).
export function useLiveSession(
  projectId: string,
  taskId: string,
  sessionId: string | null,
): UseLiveSessionResult {
  const { liveRepository } = useContainer();
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [session, setSession] = useState<LiveSession | null>(null);
  const [fileDiffs, setFileDiffs] = useState<LiveFileDiff[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  // Максимальный полученный seq — для reconnect-afterSeq и dedupe.
  const lastSeqRef = useRef(0);
  // Set seq'ов, что уже в стейте — дешёвый dedupe при наложении replay + live.
  const seenSeqRef = useRef<Set<number>>(new Set());

  const reload = useCallback(() => {
    setReloadTick((t) => t + 1);
  }, []);

  // Аккумулятор новых событий с dedupe по seq + поддержание lastSeq.
  const ingest = useCallback((incoming: LiveEvent[]) => {
    if (incoming.length === 0) return;
    setEvents((prev) => {
      const seen = seenSeqRef.current;
      const fresh = incoming.filter((e) => !seen.has(e.seq));
      if (fresh.length === 0) return prev;
      for (const e of fresh) {
        seen.add(e.seq);
        if (e.seq > lastSeqRef.current) lastSeqRef.current = e.seq;
      }
      const merged = [...prev, ...fresh];
      merged.sort((a, b) => a.seq - b.seq);
      return merged;
    });
  }, []);

  // 1) REST replay при выборе сессии / reload.
  useEffect(() => {
    if (!sessionId) {
      setEvents([]);
      setSession(null);
      setFileDiffs([]);
      setRunning(false);
      lastSeqRef.current = 0;
      seenSeqRef.current = new Set();
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    // Полный сброс перед replay новой сессии.
    lastSeqRef.current = 0;
    seenSeqRef.current = new Set();
    setEvents([]);
    setFileDiffs([]);

    void (async () => {
      try {
        const sessions = await liveRepository.listSessions(projectId, taskId);
        if (cancelled) return;
        const meta = sessions.find((s) => s.id === sessionId) ?? null;
        setSession(meta);
        setRunning(meta?.status === 'running');

        const replayed = await liveRepository.listEvents(projectId, taskId, sessionId, 0, 1000);
        if (cancelled) return;
        for (const e of replayed) {
          seenSeqRef.current.add(e.seq);
          if (e.seq > lastSeqRef.current) lastSeqRef.current = e.seq;
        }
        replayed.sort((a, b) => a.seq - b.seq);
        setEvents(replayed);

        // Завершённая сессия — сразу подтягиваем финальные git-диффы.
        if (meta && meta.status !== 'running') {
          try {
            const diffs = await liveRepository.listFileDiffs(projectId, taskId, sessionId);
            if (!cancelled) setFileDiffs(diffs);
          } catch {
            /* tolerate — диффы не критичны для ленты */
          }
        }
      } catch {
        /* tolerate — пустая лента */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId, taskId, sessionId, liveRepository, reloadTick]);

  // 2) EventSource live-хвост — открываем только для running-сессии.
  useEffect(() => {
    if (!sessionId || !running) return undefined;

    let closed = false;
    let source: EventSource | null = null;

    const open = (): void => {
      if (closed) return;
      const url =
        `/api/projects/${projectId}/tasks/${taskId}/live/sessions/${sessionId}/stream` +
        `?afterSeq=${lastSeqRef.current}`;
      source = new EventSource(url, { withCredentials: true });

      source.addEventListener('live', (event) => {
        try {
          const dto = JSON.parse((event as MessageEvent).data) as {
            seq: number;
            kind: string;
            text: string | null;
            payload: unknown;
            createdAt: string;
          };
          ingest([
            {
              seq: dto.seq,
              kind: dto.kind,
              text: dto.text,
              payload: dto.payload,
              createdAt: new Date(dto.createdAt),
            },
          ]);
        } catch {
          /* битый payload — пропускаем */
        }
      });

      source.addEventListener('live_end', (event) => {
        let status: LiveSessionStatus = 'completed';
        try {
          const dto = JSON.parse((event as MessageEvent).data) as { status?: LiveSessionStatus };
          if (dto.status) status = dto.status;
        } catch {
          /* дефолт completed */
        }
        closed = true;
        source?.close();
        setRunning(false);
        setSession((prev) => (prev ? { ...prev, status } : prev));
        // Сессия закончилась — подтягиваем финальные git-диффы.
        void liveRepository
          .listFileDiffs(projectId, taskId, sessionId)
          .then(setFileDiffs)
          .catch(() => undefined);
      });

      // onerror: EventSource сам реконнектит. Если браузер закрыл соединение
      // (readyState=CLOSED) — пересоздаём с актуальным afterSeq, чтобы reconnect
      // продолжил с последнего seq (без потерь/дублей: dedupe по seq в ingest).
      source.onerror = () => {
        if (closed) return;
        if (source && source.readyState === EventSource.CLOSED) {
          source.close();
          source = null;
          if (!closed) window.setTimeout(open, 1000);
        }
      };
    };

    open();

    return () => {
      closed = true;
      source?.close();
    };
  }, [projectId, taskId, sessionId, running, ingest, liveRepository]);

  return { events, session, fileDiffs, loading, running, reload };
}
