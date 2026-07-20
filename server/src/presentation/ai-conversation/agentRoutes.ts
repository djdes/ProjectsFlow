import { randomBytes } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z, ZodError } from 'zod';
import type { AuthenticateAgentToken } from '../../application/agent/AuthenticateAgentToken.js';
import type { AiConversationService } from '../../application/ai-conversation/AiConversationService.js';
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
    // Протокол действий — это ВЫДАЧА ПРАВ: с ним модель может предложить создание и
    // удаление проектов и задач. Режим «Размышление» (mode 'chat') на то и режим, чтобы
    // ничего не делать, поэтому права там не выдаются вовсе — модель просто рассуждает.
    // Без этого «размышление» было бы только надписью на кнопке.
    inputText: value.run.mode === 'studio_plan'
      ? `${value.inputText}\n\n${actionProtocol(value.run.projectId)}`
      : value.inputText,
    // The worker receives a bounded, already-authorized transcript only. It has
    // no conversation API, filesystem or MCP access, so follow-up answers still
    // keep context without broadening the worker capability.
    //
    // Правки элементов (mode studio_edit) остаются в истории намеренно: «поменяли
    // заголовок каталога» — тот же контекст диалога, что и обычный вопрос. А вот
    // metadata здесь не сериализуется вообще, поэтому CSS-селекторы зоны планировщику
    // не достаются; сами studio_edit-run'ы в эту очередь не попадают (их закрывает job).
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

function actionProtocol(projectId: string | null): string {
  return [
    'SYSTEM CAPABILITY: You are planning changes in ProjectsFlow. Never claim that a mutation has already happened.',
    'When the user asks to create, change, or delete ProjectsFlow projects/tasks, explain the plan briefly and append exactly one fenced block named projectsflow-actions.',
    'The block must be strict JSON: {"title":"...","summary":"...","actions":[...]}. It is hidden by the UI and only executes after explicit user confirmation.',
    'Supported actions: {"id":"stable-ref","type":"create_project","name":"..."}; {"id":"...","type":"create_task","projectId":"..." OR "projectRef":"id-of-create_project","description":"...","status":"backlog|todo|in_progress|awaiting_clarification|done|manual","deadline":"YYYY-MM-DD|null","priority":1|2|3|4|null}; {"id":"...","type":"update_task","projectId":"...","taskId":"...", optional description/status/deadline/priority}; {"id":"...","type":"delete_task","projectId":"...","taskId":"..."}; {"id":"...","type":"delete_all_tasks","projectId":"..."}.',
    `Current project id: ${projectId ?? 'none (ask for a project or create one first)'}. For actions in the current Studio, use this project id. For 100 tasks, output 100 explicit create_task actions so progress and per-item results are visible.`,
    'Attachments appear in the user text as PF_ATTACHMENT HTML comments containing base64 JSON. Read text attachments directly and use image data as visual context when supported; do not repeat the encoded payload in the answer.',
    'For ordinary questions that require no mutation, do not emit a projectsflow-actions block.',
    'PROGRESS REPORTING (optional, sent on the /complete call, NOT inside the answer body): "steps":[{"kind":"thought|query|read|write|review","detail":"one short sentence","durationMs":1200}] — at most 50. Do not send a label: the server writes the human-readable Russian one from "kind".',
    'CONTEXT REPORTING (optional, same call): "knowledge":[{"kind":"project|task|kb_page|document","id":"<entity id>","title":"...","subtitle":"...","href":"/projects/..."}] — the objects you actually looked at, at most 50. "href" must be a site-relative path.',
    'FOLLOW-UP SUGGESTIONS (optional, same call): "suggestions":[{"title":"Добавить галерею","prompt":"Добавь галерею проектов под шапкой"}] — 3 to 5 next steps the user may plausibly want. The UI shows "title" on a chip and puts "prompt" into the composer without sending it, so write the prompt as the user would phrase it, in Russian. Omit the field when nothing useful follows.',
  ].join('\n');
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
