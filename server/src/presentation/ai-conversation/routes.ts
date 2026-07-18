import { Router, type NextFunction, type Request, type Response } from 'express';
import { ZodError } from 'zod';
import type { AiConversationService } from '../../application/ai-conversation/AiConversationService.js';
import type { AiConversation } from '../../domain/ai-conversation/AiConversation.js';
import type { AiConversationEvent } from '../../domain/ai-conversation/AiConversationEvent.js';
import type { AiConversationMessage } from '../../domain/ai-conversation/AiMessage.js';
import type { AiConversationRun } from '../../domain/ai-conversation/AiRun.js';
import {
  AiConversationCompletionConflictError,
  AiConversationDispatcherMissingError,
  AiConversationNotFoundError,
  AiConversationRunNotFoundError,
  AiConversationRunStateConflictError,
  AiConversationValidationError,
  AiConversationVersionConflictError,
} from '../../domain/ai-conversation/errors.js';
import type { AiConversationEventHub } from '../../infrastructure/realtime/AiConversationEventHub.js';
import { requireAuth } from '../middleware/requireAuth.js';
import {
  createConversationSchema,
  listConversationsQuerySchema,
  listMessagesQuerySchema,
  sendMessageSchema,
  streamQuerySchema,
  updateConversationSchema,
  versionSchema,
} from './schemas.js';

export type AiConversationRouterDeps = {
  readonly service: AiConversationService;
  readonly eventHub: AiConversationEventHub;
};

// Mount under /api/ai. Project convenience routes are exported separately so the
// composition root can mount them under /api/projects without coupling this feature.
export function aiConversationRouter(deps: AiConversationRouterDeps): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/conversations', async (req, res, next) => {
    try {
      const query = listConversationsQuerySchema.parse(req.query);
      const conversations = await deps.service.list(uid(req), query);
      const last = conversations.at(-1);
      res.json({
        conversations: conversations.map(conversationDto),
        nextCursor: last && conversations.length >= (query.limit ?? 50)
          ? (last.lastMessageAt ?? last.createdAt).toISOString()
          : null,
      });
    } catch (error) { handleError(error, res, next); }
  });

  router.post('/conversations', async (req, res, next) => {
    try {
      const body = createConversationSchema.parse(req.body);
      const conversation = await deps.service.create(uid(req), body);
      res.status(201).json({ conversation: conversationDto(conversation) });
    } catch (error) { handleError(error, res, next); }
  });

  router.get('/conversations/:conversationId', async (req, res, next) => {
    try {
      const conversation = await deps.service.get(uid(req), cid(req));
      res.json({ conversation: conversationDto(conversation) });
    } catch (error) { handleError(error, res, next); }
  });

  router.patch('/conversations/:conversationId', async (req, res, next) => {
    try {
      const body = updateConversationSchema.parse(req.body);
      const conversation = await deps.service.rename(
        uid(req), cid(req), body.title, body.expectedVersion,
      );
      res.json({ conversation: conversationDto(conversation) });
    } catch (error) { handleError(error, res, next); }
  });

  // DELETE archives instead of physically removing durable history.
  router.delete('/conversations/:conversationId', async (req, res, next) => {
    try {
      const body = versionSchema.parse(req.body ?? {});
      const conversation = await deps.service.archive(uid(req), cid(req), body.expectedVersion);
      res.json({ conversation: conversationDto(conversation) });
    } catch (error) { handleError(error, res, next); }
  });

  router.post('/conversations/:conversationId/restore', async (req, res, next) => {
    try {
      const body = versionSchema.parse(req.body ?? {});
      const conversation = await deps.service.restore(uid(req), cid(req), body.expectedVersion);
      res.json({ conversation: conversationDto(conversation) });
    } catch (error) { handleError(error, res, next); }
  });

  router.get('/conversations/:conversationId/messages', async (req, res, next) => {
    try {
      const query = listMessagesQuerySchema.parse(req.query);
      const messages = await deps.service.listMessages(uid(req), cid(req), query);
      const cursorMessage = query.afterSeq === undefined ? messages[0] : messages.at(-1);
      res.json({
        messages: messages.map(messageDto),
        nextCursor: cursorMessage && messages.length >= (query.limit ?? 50)
          ? String(cursorMessage.seq)
          : null,
      });
    } catch (error) { handleError(error, res, next); }
  });

  router.post('/conversations/:conversationId/messages', async (req, res, next) => {
    try {
      const body = sendMessageSchema.parse(req.body);
      const result = await deps.service.sendMessage(uid(req), cid(req), {
        ...body,
        requestId: requestId(req),
      });
      res.status(result.replayed ? 200 : 202).json({
        conversation: conversationDto(result.conversation),
        userMessage: messageDto(result.userMessage),
        assistantMessage: messageDto(result.assistantMessage),
        run: runDto(result.run),
        replayed: result.replayed,
      });
    } catch (error) { handleError(error, res, next); }
  });

  router.post('/conversations/:conversationId/runs/:runId/cancel', async (req, res, next) => {
    try {
      const result = await deps.service.cancelRun(
        uid(req), cid(req), req.params['runId'] as string, requestId(req),
      );
      res.json({ run: runDto(result.run), assistantMessage: messageDto(result.assistantMessage) });
    } catch (error) { handleError(error, res, next); }
  });

  router.get('/conversations/:conversationId/stream', async (req, res, next) => {
    await streamConversation(deps, req, res, next);
  });

  return router;
}

// Mount under /api/projects.
export function projectStudioConversationRouter(deps: AiConversationRouterDeps): Router {
  const router = Router();
  router.use(requireAuth);
  router.get('/:projectId/studio/conversations', async (req, res, next) => {
    try {
      const projectId = req.params['projectId'] as string;
      const conversations = await deps.service.list(uid(req), {
        kind: 'project_studio', projectId, archived: false, limit: 100,
      });
      res.json({ conversations: conversations.map(conversationDto) });
    } catch (error) { handleError(error, res, next); }
  });
  router.post('/:projectId/studio/conversations', async (req, res, next) => {
    try {
      const conversation = await deps.service.getOrCreateProjectStudio(
        uid(req), req.params['projectId'] as string,
      );
      res.status(200).json({ conversation: conversationDto(conversation) });
    } catch (error) { handleError(error, res, next); }
  });
  return router;
}

async function streamConversation(
  deps: AiConversationRouterDeps,
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const conversationId = cid(req);
  let afterEventSeq: number;
  try {
    await deps.service.assertCanAccess(uid(req), conversationId);
    const headerCursor = req.header('last-event-id');
    const query = streamQuerySchema.parse(req.query);
    afterEventSeq = query.afterEventSeq ?? (headerCursor ? Number(headerCursor) : 0);
    if (!Number.isSafeInteger(afterEventSeq) || afterEventSeq < 0) afterEventSeq = 0;
  } catch (error) {
    handleError(error, res, next);
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 5000\n\n');

  let closed = false;
  let replaying = true;
  const buffered: AiConversationEvent[] = [];
  const writeEvent = (event: AiConversationEvent): void => {
    res.write(`id: ${event.eventSeq}\nevent: ai-conversation\ndata: ${JSON.stringify(eventDto(event))}\n\n`);
  };
  const unsubscribe = deps.eventHub.subscribe(conversationId, (event) => {
    if (replaying) buffered.push(event);
    else writeEvent(event);
  });

  let cursor = afterEventSeq;
  try {
    for (;;) {
      const page = await deps.service.listEvents(uid(req), conversationId, cursor, 100);
      if (page.length === 0) break;
      for (const event of page) {
        writeEvent(event);
        cursor = Math.max(cursor, event.eventSeq);
      }
      if (page.length < 100) break;
    }
  } catch {
    closed = true;
    unsubscribe();
    res.end();
    return;
  }

  replaying = false;
  for (const event of buffered) if (event.eventSeq > cursor) writeEvent(event);
  buffered.length = 0;

  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
  });
}

function conversationDto(value: AiConversation): unknown {
  return {
    id: value.id,
    kind: value.kind,
    projectId: value.projectId,
    workspaceId: value.workspaceId,
    title: value.title,
    version: value.version,
    lastMessageSeq: value.lastMessageSeq == null ? null : String(value.lastMessageSeq),
    lastMessageAt: value.lastMessageAt?.toISOString() ?? null,
    archivedAt: value.archivedAt?.toISOString() ?? null,
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
  };
}

function messageDto(value: AiConversationMessage): unknown {
  return {
    id: value.id,
    seq: String(value.seq),
    conversationId: value.conversationId,
    role: value.role,
    status: value.status,
    body: value.body,
    parentMessageId: value.parentMessageId,
    clientRequestId: value.clientRequestId,
    runId: value.runId,
    model: value.model,
    metadata: value.metadata,
    error: value.errorCode ? { code: value.errorCode, retryable: value.errorRetryable } : null,
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
  };
}

function runDto(value: AiConversationRun): unknown {
  return {
    id: value.id,
    conversationId: value.conversationId,
    projectId: value.projectId,
    mode: value.mode,
    status: value.status,
    assistantMessageId: value.assistantMessageId,
    model: value.model,
    error: value.errorCode ? { code: value.errorCode, message: value.errorMessage } : null,
    createdAt: value.createdAt.toISOString(),
    startedAt: value.startedAt?.toISOString() ?? null,
    finishedAt: value.finishedAt?.toISOString() ?? null,
  };
}

function eventDto(value: AiConversationEvent): unknown {
  return {
    eventSeq: String(value.eventSeq),
    conversationId: value.conversationId,
    eventType: value.eventType,
    entityId: value.entityId,
    payload: value.payload,
    createdAt: value.createdAt.toISOString(),
  };
}

function uid(req: Request): string { return req.user!.id; }
function cid(req: Request): string { return req.params['conversationId'] as string; }
function requestId(req: Request): string | null { return req.header('x-request-id') ?? null; }

function handleError(error: unknown, res: Response, next: NextFunction): void {
  const reqId: string | null = res.req ? requestId(res.req) : null;
  const envelope = (code: string, message: string, details?: Record<string, unknown>) => ({
    error: { code, message, ...(details ? { details } : {}), requestId: reqId },
  });
  if (error instanceof ZodError || error instanceof AiConversationValidationError) {
    res.status(400).json(envelope('INVALID_REQUEST', error.message));
  } else if (error instanceof AiConversationNotFoundError || error instanceof AiConversationRunNotFoundError) {
    res.status(404).json(envelope(error.code, error.message));
  } else if (error instanceof AiConversationVersionConflictError) {
    res.status(409).json(envelope(error.code, error.message, { currentVersion: error.currentVersion }));
  } else if (error instanceof AiConversationRunStateConflictError) {
    res.status(409).json(envelope(error.code, error.message, { currentStatus: error.currentStatus }));
  } else if (error instanceof AiConversationCompletionConflictError) {
    res.status(409).json(envelope(error.code, error.message));
  } else if (error instanceof AiConversationDispatcherMissingError) {
    res.status(409).json(envelope(error.code, error.message));
  } else {
    next(error);
  }
}
