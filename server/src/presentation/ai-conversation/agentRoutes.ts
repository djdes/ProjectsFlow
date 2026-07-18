import { randomBytes } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z, ZodError } from 'zod';
import type { AuthenticateAgentToken } from '../../application/agent/AuthenticateAgentToken.js';
import type { AiConversationService } from '../../application/ai-conversation/AiConversationService.js';
import type { AiConversationRun, PendingAiConversationRun } from '../../domain/ai-conversation/AiRun.js';
import {
  AiConversationCompletionConflictError,
  AiConversationRunNotFoundError,
  AiConversationRunStateConflictError,
} from '../../domain/ai-conversation/errors.js';
import { requireAgentCapabilityScope } from '../middleware/requireAgentCapabilityScope.js';
import { requireAgentToken } from '../middleware/requireAgentToken.js';

type Deps = {
  readonly authenticate: AuthenticateAgentToken;
  readonly service: AiConversationService;
};

const completeSchema = z.object({
  leaseToken: z.string().min(20).max(256),
  idempotencyKey: z.string().min(8).max(128),
  body: z.string().min(1).max(100_000),
  model: z.string().min(1).max(120).nullable().optional(),
  tokensIn: z.number().int().nonnegative().nullable().optional(),
  tokensOut: z.number().int().nonnegative().nullable().optional(),
  costUsd: z.number().nonnegative().nullable().optional(),
}).strict();

const failSchema = z.object({
  leaseToken: z.string().min(20).max(256),
  idempotencyKey: z.string().min(8).max(128),
  errorCode: z.string().min(1).max(80),
  errorMessage: z.string().min(1).max(1_000),
  retryable: z.boolean().default(true),
}).strict();

// Отдельный read-only AI worker. Этот router принимает только dispatcher account token:
// project capability отвергается requireAgentCapabilityScope, потому что URL не содержит
// /projects/:id. В отличие от site-editor worker он не получает файловую систему/MCP и
// видит лишь redacted context snapshot конкретного run.
export function aiConversationAgentRouter(deps: Deps): Router {
  const router = Router();
  router.use(requireAgentToken(deps.authenticate));
  router.use(requireAgentCapabilityScope());

  router.get('/ai-conversation-runs/pending', async (req, res, next) => {
    try {
      const raw = Number(req.query['limit'] ?? 20);
      const limit = Number.isFinite(raw) ? Math.max(1, Math.min(100, Math.trunc(raw))) : 20;
      const runs = await deps.service.listPendingRuns(req.user!.id, limit);
      res.json({ runs: runs.map(pendingDto) });
    } catch (error) { handle(error, res, next); }
  });

  router.post('/ai-conversation-runs/:runId/claim', async (req, res, next) => {
    try {
      const leaseToken = randomBytes(32).toString('base64url');
      const leaseExpiresAt = new Date(Date.now() + 5 * 60_000);
      const run = await deps.service.claimRun({
        runId: req.params['runId'] as string,
        dispatcherUserId: req.user!.id,
        leaseToken,
        leaseExpiresAt,
      });
      res.json({ run: runDto(run), leaseToken, leaseExpiresAt: leaseExpiresAt.toISOString() });
    } catch (error) { handle(error, res, next); }
  });

  router.post('/ai-conversation-runs/:runId/complete', async (req, res, next) => {
    try {
      const body = completeSchema.parse(req.body);
      const result = await deps.service.completeRun({
        runId: req.params['runId'] as string,
        dispatcherUserId: req.user!.id,
        leaseToken: body.leaseToken,
        completionIdempotencyKey: body.idempotencyKey,
        body: body.body,
        model: body.model ?? null,
        tokensIn: body.tokensIn ?? null,
        tokensOut: body.tokensOut ?? null,
        costUsd: body.costUsd ?? null,
        requestId: req.header('x-request-id') ?? null,
      });
      res.json({ run: runDto(result.run), assistantMessage: result.assistantMessage });
    } catch (error) { handle(error, res, next); }
  });

  router.post('/ai-conversation-runs/:runId/fail', async (req, res, next) => {
    try {
      const body = failSchema.parse(req.body);
      const result = await deps.service.failRun({
        runId: req.params['runId'] as string,
        dispatcherUserId: req.user!.id,
        leaseToken: body.leaseToken,
        completionIdempotencyKey: body.idempotencyKey,
        errorCode: body.errorCode,
        errorMessage: body.errorMessage,
        retryable: body.retryable,
        requestId: req.header('x-request-id') ?? null,
      });
      res.json({ run: runDto(result.run), assistantMessage: result.assistantMessage });
    } catch (error) { handle(error, res, next); }
  });

  return router;
}

function pendingDto(value: PendingAiConversationRun): unknown {
  return {
    run: runDto(value.run),
    conversationTitle: value.conversationTitle,
    projectName: value.projectName,
    inputText: value.inputText,
    // The worker receives a bounded, already-authorized transcript only. It has
    // no conversation API, filesystem or MCP access, so follow-up answers still
    // keep context without broadening the worker capability.
    history: value.history.map((message) => ({
      id: message.id,
      seq: String(message.seq),
      role: message.role,
      status: message.status,
      body: message.body,
      model: message.model,
      createdAt: message.createdAt.toISOString(),
    })),
  };
}

function runDto(value: AiConversationRun): unknown {
  return {
    id: value.id,
    conversationId: value.conversationId,
    projectId: value.projectId,
    mode: value.mode,
    status: value.status,
    contextVersion: value.contextVersion,
    contextSnapshot: value.contextSnapshot,
    createdAt: value.createdAt.toISOString(),
  };
}

function handle(error: unknown, res: Response, next: NextFunction): void {
  if (error instanceof ZodError) {
    res.status(400).json({ error: { code: 'INVALID_REQUEST', message: error.message } });
  } else if (error instanceof AiConversationRunNotFoundError) {
    res.status(404).json({ error: { code: error.code, message: error.message } });
  } else if (error instanceof AiConversationRunStateConflictError) {
    res.status(409).json({ error: { code: error.code, message: error.message, currentStatus: error.currentStatus } });
  } else if (error instanceof AiConversationCompletionConflictError) {
    res.status(409).json({ error: { code: error.code, message: error.message } });
  } else {
    next(error);
  }
}
