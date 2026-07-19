import { Router, type NextFunction, type Request, type Response } from 'express';
import { ZodError } from 'zod';
import type { AiActionBatchService } from '../../application/ai-action/AiActionBatchService.js';
import type { AiActionBatch, AiActionBatchItem } from '../../domain/ai-action/AiActionBatch.js';
import {
  AiActionBatchNotFoundError,
  AiActionBatchStateConflictError,
  AiActionBatchValidationError,
} from '../../domain/ai-action/errors.js';
import {
  AiConversationNotFoundError,
  AiConversationValidationError,
} from '../../domain/ai-conversation/errors.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { createBatchSchema, resultsSchema } from './schemas.js';

export type AiActionBatchRouterDeps = {
  readonly service: AiActionBatchService;
};

/**
 * Mount under /api/ai. Batches hang off a conversation, and a personal conversation has
 * no project at all, so ownership of the conversation — not project membership — is the
 * access gate here.
 */
export function aiActionBatchRouter(deps: AiActionBatchRouterDeps): Router {
  const router = Router();
  router.use(requireAuth);

  router.post('/action-batches', async (req, res, next) => {
    try {
      const body = createBatchSchema.parse(req.body);
      const result = await deps.service.create(uid(req), body);
      // 200 on replay, 201 on a genuinely new batch: the client keys "do not execute
      // this plan again" off exactly this distinction.
      res.status(result.replayed ? 200 : 201).json({
        batch: batchDto(result.batch),
        replayed: result.replayed,
      });
    } catch (error) { handleError(error, res, next); }
  });

  router.get('/action-batches/:batchId', async (req, res, next) => {
    try {
      res.json({ batch: batchDto(await deps.service.get(uid(req), bid(req))) });
    } catch (error) { handleError(error, res, next); }
  });

  router.post('/action-batches/:batchId/results', async (req, res, next) => {
    try {
      const body = resultsSchema.parse(req.body ?? {});
      const batch = await deps.service.recordResults(uid(req), bid(req), body.results);
      res.json({ batch: batchDto(batch) });
    } catch (error) { handleError(error, res, next); }
  });

  router.post('/action-batches/:batchId/apply', async (req, res, next) => {
    try {
      const body = resultsSchema.parse(req.body ?? {});
      const batch = await deps.service.apply(uid(req), bid(req), body.results);
      res.json({ batch: batchDto(batch) });
    } catch (error) { handleError(error, res, next); }
  });

  router.post('/action-batches/:batchId/reject', async (req, res, next) => {
    try {
      res.json({ batch: batchDto(await deps.service.reject(uid(req), bid(req))) });
    } catch (error) { handleError(error, res, next); }
  });

  router.post('/action-batches/:batchId/undo', async (req, res, next) => {
    try {
      res.json({ batch: batchDto(await deps.service.undo(uid(req), bid(req))) });
    } catch (error) { handleError(error, res, next); }
  });

  router.get('/conversations/:conversationId/action-batches', async (req, res, next) => {
    try {
      const batches = await deps.service.listForConversation(
        uid(req), req.params['conversationId'] as string,
      );
      res.json({ batches: batches.map(batchDto) });
    } catch (error) { handleError(error, res, next); }
  });

  // Панель Artifacts: накопительный журнал за диалог, поэтому живёт рядом с батчами,
  // а не рассчитывается по текущему состоянию задач/проектов.
  router.get('/conversations/:conversationId/artifacts', async (req, res, next) => {
    try {
      const artifacts = await deps.service.listArtifacts(
        uid(req), req.params['conversationId'] as string,
      );
      res.json({ artifacts, count: artifacts.length });
    } catch (error) { handleError(error, res, next); }
  });

  return router;
}

function batchDto(value: AiActionBatch): unknown {
  return {
    id: value.id,
    conversationId: value.conversationId,
    messageId: value.messageId,
    projectId: value.projectId,
    status: value.status,
    title: value.title,
    appliedAt: value.appliedAt?.toISOString() ?? null,
    undoneAt: value.undoneAt?.toISOString() ?? null,
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
    items: value.items.map(itemDto),
  };
}

function itemDto(value: AiActionBatchItem): unknown {
  return {
    id: value.id,
    position: value.position,
    actionId: value.actionId,
    type: value.type,
    entityKind: value.entityKind,
    entityId: value.entityId,
    projectId: value.projectId,
    title: value.title,
    status: value.status,
    errorMessage: value.errorMessage,
  };
}

function uid(req: Request): string { return req.user!.id; }
function bid(req: Request): string { return req.params['batchId'] as string; }

function handleError(error: unknown, res: Response, next: NextFunction): void {
  const requestId = res.req?.header('x-request-id') ?? null;
  const envelope = (code: string, message: string, details?: Record<string, unknown>) => ({
    error: { code, message, ...(details ? { details } : {}), requestId },
  });
  if (
    error instanceof ZodError
    || error instanceof AiActionBatchValidationError
    || error instanceof AiConversationValidationError
  ) {
    res.status(400).json(envelope('INVALID_REQUEST', error.message));
  } else if (
    error instanceof AiActionBatchNotFoundError
    || error instanceof AiConversationNotFoundError
  ) {
    res.status(404).json(envelope(error.code, error.message));
  } else if (error instanceof AiActionBatchStateConflictError) {
    res.status(409).json(envelope(error.code, error.message, { currentStatus: error.currentStatus }));
  } else {
    next(error);
  }
}
