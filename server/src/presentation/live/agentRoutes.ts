import { Router, type Request } from 'express';
import { z } from 'zod';
import { requireAgentToken } from '../middleware/requireAgentToken.js';
import { requireAgentCapabilityScope } from '../middleware/requireAgentCapabilityScope.js';
import type { AuthenticateAgentToken } from '../../application/agent/AuthenticateAgentToken.js';
import type { LiveService } from '../../application/live/LiveService.js';

export type LiveAgentRouterDeps = {
  readonly service: LiveService;
  readonly authenticate: AuthenticateAgentToken;
};

const startSchema = z.object({
  agentName: z.string().min(1).max(64),
  attempt: z.number().int().positive().optional(),
  model: z.string().max(64).nullable().optional(),
  headBefore: z.string().max(64).nullable().optional(),
});

// Тот же приём, что у file-sync eventsSchema: батч ≤64, kind ≤32, payload свободный.
const eventsSchema = z.object({
  events: z
    .array(
      z.object({
        seq: z.number().int().nonnegative(),
        kind: z.string().min(1).max(32),
        text: z.string().nullable().optional(),
        payload: z.unknown().optional(),
      }),
    )
    .max(64),
});

const fileDiffSchema = z.object({
  path: z.string().min(1).max(1024),
  change: z.enum(['added', 'modified', 'deleted', 'renamed']),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  unifiedDiff: z.string().nullable().optional(),
  isBinary: z.boolean().optional(),
  truncated: z.boolean().optional(),
});

const finishSchema = z.object({
  status: z.enum(['completed', 'failed', 'timeout', 'canceled']),
  headAfter: z.string().max(64).nullable().optional(),
  costUsd: z.number().nullable().optional(),
  tokensIn: z.number().int().nonnegative().nullable().optional(),
  tokensOut: z.number().int().nonnegative().nullable().optional(),
  fileDiffs: z.array(fileDiffSchema).max(2000).optional(),
});

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

// Ingest LIVE-стрима (Bearer; авторизация внутри LiveService через requireDispatcherAccess).
// Маунтится под /api/agent (рядом с fileSyncRouter), ПОСЛЕ agentApiRouter.
export function liveAgentRouter(deps: LiveAgentRouterDeps): Router {
  const router = Router();
  router.use(requireAgentToken(deps.authenticate));
  router.use(requireAgentCapabilityScope());
  const svc = deps.service;

  router.post('/projects/:projectId/tasks/:taskId/live/sessions', async (req, res, next) => {
    try {
      const body = startSchema.parse(req.body);
      const out = await svc.startSession(pid(req), uid(req), tid(req), {
        agentName: body.agentName,
        attempt: body.attempt,
        model: body.model ?? null,
        headBefore: body.headBefore ?? null,
      });
      res.status(201).json(out);
    } catch (e) {
      next(e);
    }
  });

  router.post(
    '/projects/:projectId/tasks/:taskId/live/sessions/:sessionId/events',
    async (req, res, next) => {
      try {
        const body = eventsSchema.parse(req.body);
        const out = await svc.appendEvents(pid(req), uid(req), tid(req), sid(req), body.events);
        res.status(200).json(out);
      } catch (e) {
        next(e);
      }
    },
  );

  router.post(
    '/projects/:projectId/tasks/:taskId/live/sessions/:sessionId/finish',
    async (req, res, next) => {
      try {
        const body = finishSchema.parse(req.body);
        const out = await svc.finishSession(pid(req), uid(req), tid(req), sid(req), {
          status: body.status,
          headAfter: body.headAfter ?? null,
          costUsd: body.costUsd ?? null,
          tokensIn: body.tokensIn ?? null,
          tokensOut: body.tokensOut ?? null,
          fileDiffs: body.fileDiffs,
        });
        res.status(200).json(out);
      } catch (e) {
        next(e);
      }
    },
  );

  return router;
}
