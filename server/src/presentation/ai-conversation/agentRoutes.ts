import { randomBytes } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z, ZodError } from 'zod';
import type { AuthenticateAgentToken } from '../../application/agent/AuthenticateAgentToken.js';
import type { AiConversationService } from '../../application/ai-conversation/AiConversationService.js';
import {
  aiConversationWorkerHistory,
  aiConversationWorkerInputText,
} from '../../application/ai-conversation/aiConversationWorkerInput.js';
import {
  MAX_AI_AGENT_STEPS,
  normalizeAgentSteps,
} from '../../domain/ai-conversation/AiAgentStep.js';
import {
  MAX_AI_KNOWLEDGE_SOURCES,
  normalizeKnowledgeSources,
} from '../../domain/ai-conversation/AiKnowledgeSource.js';
import {
  MAX_AI_SUGGESTION_PROMPT,
  MAX_AI_SUGGESTION_TITLE,
  MAX_AI_SUGGESTIONS,
  normalizeAiSuggestions,
} from '../../domain/ai-conversation/AiSuggestion.js';
import type { AiConversationRun, PendingAiConversationRun } from '../../domain/ai-conversation/AiRun.js';
import {
  AiConversationCompletionConflictError,
  AiConversationRunNotFoundError,
  AiConversationRunStateConflictError,
} from '../../domain/ai-conversation/errors.js';
import { requireAgentCapabilityScope } from '../middleware/requireAgentCapabilityScope.js';
import { requireAgentToken } from '../middleware/requireAgentToken.js';
import { agentStepSchema } from './schemas.js';

type Deps = {
  readonly authenticate: AuthenticateAgentToken;
  readonly service: AiConversationService;
};

// Шаги, источники и подсказки опциональны: воркер, который их не шлёт, обязан
// продолжать работать ровно как раньше — блок шагов, панели и ряд подсказок просто
// не появятся.
const knowledgeSchema = z.object({
  id: z.string().min(1).max(80),
  kind: z.enum(['project', 'task', 'kb_page', 'document']),
  title: z.string().min(1).max(300),
  subtitle: z.string().max(200).nullable().optional(),
  href: z.string().max(300).nullable().optional(),
}).strict();

// Голая строка — законная краткая форма подсказки: подпись совпадает с промптом.
const suggestionSchema = z.union([
  z.string().min(1).max(MAX_AI_SUGGESTION_PROMPT),
  z.object({
    id: z.string().min(1).max(80).optional(),
    title: z.string().max(MAX_AI_SUGGESTION_TITLE).optional(),
    prompt: z.string().min(1).max(MAX_AI_SUGGESTION_PROMPT),
  }).strict(),
]);

const completeSchema = z.object({
  leaseToken: z.string().min(20).max(256),
  idempotencyKey: z.string().min(8).max(128),
  body: z.string().min(1).max(100_000),
  model: z.string().min(1).max(120).nullable().optional(),
  tokensIn: z.number().int().nonnegative().nullable().optional(),
  tokensOut: z.number().int().nonnegative().nullable().optional(),
  costUsd: z.number().nonnegative().nullable().optional(),
  steps: z.array(agentStepSchema).max(MAX_AI_AGENT_STEPS).nullable().optional(),
  knowledge: z.array(knowledgeSchema).max(MAX_AI_KNOWLEDGE_SOURCES).nullable().optional(),
  suggestions: z.array(suggestionSchema).max(MAX_AI_SUGGESTIONS).nullable().optional(),
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
        steps: body.steps == null ? null : normalizeAgentSteps(body.steps),
        knowledge: body.knowledge == null ? null : normalizeKnowledgeSources(body.knowledge),
        suggestions: body.suggestions == null ? null : normalizeAiSuggestions(body.suggestions),
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
    // Текст и история — те же, что получает серверный исполнитель (aiConversationServerQueue):
    // протокол действий только у studio_plan, история без metadata.
    inputText: aiConversationWorkerInputText(value.run, value.inputText),
    history: aiConversationWorkerHistory(value.history),
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
