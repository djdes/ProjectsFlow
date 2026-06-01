import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import type { LiveService } from '../../application/live/LiveService.js';
import type { LiveEventHub } from '../../infrastructure/realtime/LiveEventHub.js';
import type { LiveSession, LiveSessionFinalStatus } from '../../domain/live/LiveSession.js';
import type { LiveEvent } from '../../domain/live/LiveEvent.js';
import type { LiveFileDiff } from '../../domain/live/LiveFileDiff.js';
import { LiveSessionGoneError } from '../../domain/live/errors.js';

export type LiveUserRouterDeps = {
  readonly service: LiveService;
  readonly liveEventHub: LiveEventHub;
};

// Сколько после завершения сессии ещё разрешаем live-стрим (потом 410 → клиент читает историю).
const STREAM_GONE_AFTER_MS = 5 * 60 * 1000; // 5 минут

type LiveSessionDto = {
  id: string;
  taskId: string;
  projectId: string;
  agentName: string | null;
  attempt: number;
  status: LiveSession['status'];
  model: string | null;
  headBefore: string | null;
  headAfter: string | null;
  costUsd: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  eventCount: number;
  lastSeq: number;
  startedAt: string;
  endedAt: string | null;
};

type LiveEventDto = {
  seq: number;
  kind: string;
  text: string | null;
  payload: unknown;
  createdAt: string;
};

function toSessionDto(s: LiveSession): LiveSessionDto {
  return {
    id: s.id,
    taskId: s.taskId,
    projectId: s.projectId,
    agentName: s.agentName,
    attempt: s.attempt,
    status: s.status,
    model: s.model,
    headBefore: s.headBefore,
    headAfter: s.headAfter,
    costUsd: s.costUsd,
    tokensIn: s.tokensIn,
    tokensOut: s.tokensOut,
    eventCount: s.eventCount,
    lastSeq: s.lastSeq,
    startedAt: s.startedAt.toISOString(),
    endedAt: s.endedAt?.toISOString() ?? null,
  };
}

function toEventDto(e: LiveEvent): LiveEventDto {
  return {
    seq: e.seq,
    kind: e.kind,
    text: e.text,
    payload: e.payload,
    createdAt: e.createdAt.toISOString(),
  };
}

function toFileDiffDto(d: LiveFileDiff): LiveFileDiff {
  return d;
}

function pid(req: Request): string {
  return req.params['projectId'] as string;
}
function tid(req: Request): string {
  return req.params['taskId'] as string;
}
function sid(req: Request): string {
  return req.params['sessionId'] as string;
}
function uid(req: Request): string {
  return req.user!.id;
}

// Read + SSE LIVE-стрима (cookie requireAuth + requireProjectAccess('read_project') внутри
// LiveService). Маунтится под /api/projects.
export function liveUserRouter(deps: LiveUserRouterDeps): Router {
  const router = Router();
  router.use(requireAuth);
  const svc = deps.service;

  router.get('/:projectId/tasks/:taskId/live/sessions', async (req, res, next) => {
    try {
      const sessions = await svc.listSessions(pid(req), uid(req), tid(req));
      res.json({ sessions: sessions.map(toSessionDto) });
    } catch (e) {
      next(e);
    }
  });

  router.get(
    '/:projectId/tasks/:taskId/live/sessions/:sessionId/events',
    async (req, res, next) => {
      try {
        const afterSeq = Number(req.query['afterSeq'] ?? 0) || 0;
        const limit = Math.min(Number(req.query['limit'] ?? 500) || 500, 2000);
        const events = await svc.listEvents(pid(req), uid(req), tid(req), sid(req), afterSeq, limit);
        res.json({ events: events.map(toEventDto) });
      } catch (e) {
        next(e);
      }
    },
  );

  router.get(
    '/:projectId/tasks/:taskId/live/sessions/:sessionId/file-diffs',
    async (req, res, next) => {
      try {
        const files = await svc.listFileDiffs(pid(req), uid(req), tid(req), sid(req));
        res.json({ files: files.map(toFileDiffDto) });
      } catch (e) {
        next(e);
      }
    },
  );

  // SSE: replay из БД (seq > afterSeq) → subscribe firehose из LiveEventHub(taskId).
  // requireProjectAccess('read_project') ДО writeHead (через svc.getSessionForStream).
  // Заголовки/heartbeat — копия notifications/routes.ts.
  router.get('/:projectId/tasks/:taskId/live/sessions/:sessionId/stream', async (req, res, next) => {
    const taskId = tid(req);
    const sessionId = sid(req);
    let session: LiveSession;
    try {
      session = await svc.getSessionForStream(pid(req), uid(req), taskId, sessionId);
    } catch (e) {
      next(e);
      return;
    }

    // Сессия завершилась давно — нет смысла держать live-коннект, клиент читает историю.
    if (session.endedAt && Date.now() - session.endedAt.getTime() > STREAM_GONE_AFTER_MS) {
      next(new LiveSessionGoneError(sessionId));
      return;
    }

    const afterSeqStart = Number(req.query['afterSeq'] ?? 0) || 0;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 5000\n\n');

    const writeEvent = (e: LiveEvent): void => {
      res.write(`event: live\ndata: ${JSON.stringify(toEventDto(e))}\n\n`);
    };
    const writeEnd = (status: LiveSessionFinalStatus): void => {
      res.write(`event: live_end\ndata: ${JSON.stringify({ status })}\n\n`);
    };

    let closed = false;
    let unsubscribe = (): void => {};
    let unsubscribeEnd = (): void => {};

    // Replay из БД, потом подписка на firehose. Подписку ставим до конца replay'я, чтобы
    // не потерять события, прилетевшие в окне между чтением БД и subscribe; idempotent seq
    // на клиенте (afterSeq) разрулит дубли. Буферизуем live-события во время replay.
    const buffered: LiveEvent[] = [];
    let replaying = true;
    unsubscribe = deps.liveEventHub.subscribe(taskId, (events) => {
      if (replaying) {
        buffered.push(...events);
        return;
      }
      for (const e of events) writeEvent(e);
    });
    unsubscribeEnd = deps.liveEventHub.subscribeEnd(taskId, (status) => {
      writeEnd(status);
    });

    let lastReplayedSeq = afterSeqStart;
    try {
      const PAGE = 1000;
      // Пагинированный replay (длинные сессии).
      for (;;) {
        const page = await svc.listEvents(
          pid(req),
          uid(req),
          taskId,
          sessionId,
          lastReplayedSeq,
          PAGE,
        );
        if (page.length === 0) break;
        for (const e of page) {
          writeEvent(e);
          if (e.seq > lastReplayedSeq) lastReplayedSeq = e.seq;
        }
        if (page.length < PAGE) break;
      }
    } catch {
      // Чтение БД упало после writeHead — закрываем коннект, EventSource переподключится.
      if (!closed) {
        closed = true;
        unsubscribe();
        unsubscribeEnd();
        res.end();
      }
      return;
    }

    // Сливаем буфер, накопленный во время replay (без уже отданных seq).
    replaying = false;
    for (const e of buffered) {
      if (e.seq > lastReplayedSeq) writeEvent(e);
    }
    buffered.length = 0;

    const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);

    req.on('close', () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      unsubscribeEnd();
    });
  });

  return router;
}
