import { Readable } from 'node:stream';
import express, { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type { AuthenticateAgentToken } from '../../application/agent/AuthenticateAgentToken.js';
import type { LlmGateway } from '../../application/llm/LlmGateway.js';
import type { GenerateLlmText } from '../../application/llm/LlmTextGenerator.js';
import { RUN_PROMPT_INSTRUCTIONS } from '../../application/llm/promptTemplate.js';
import type { TaskRepository } from '../../application/task/TaskRepository.js';
import { isValidLlmModelName } from '../../domain/llm/LlmSettings.js';
import {
  LlmEmptyResponseError,
  LlmNotConnectedError,
  LlmRateLimitedError,
  LlmReauthRequiredError,
  LlmUpstreamBlockedError,
  LlmUpstreamError,
} from '../../domain/llm/errors.js';
import { requireAgentToken } from '../middleware/requireAgentToken.js';

// codex каждый ход шлёт всю историю диалога: тело растёт с длиной сессии.
const MAX_BODY = '64mb';
// Короткие задания Ralph несут в промпте базу знаний проектов.
const MAX_TEXT_BODY = '16mb';
// Плательщик задачи нужен на каждый запрос воркера — кэшируем ненадолго.
const BILLING_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_TEXT_TIMEOUT_SEC = 300;

type Deps = {
  readonly authenticate: AuthenticateAgentToken;
  readonly gateway: LlmGateway;
  readonly text: GenerateLlmText;
  readonly tasks: Pick<TaskRepository, 'getById'>;
};

const PATHS = [
  '/llm/v1/responses',
  '/llm/v1/responses/compact',
  '/projects/:projectId/llm/v1/responses',
  '/projects/:projectId/llm/v1/responses/compact',
];
const TEXT_PATHS = ['/llm/v1/generate', '/projects/:projectId/llm/v1/generate'];

const textSchema = z.object({
  input: z.string().min(1),
  instructions: z.string().min(1).optional(),
  tier: z.enum(['default', 'fast']).optional(),
  reasoningEffort: z.enum(['low', 'medium', 'high']).optional(),
  timeoutSec: z.number().int().min(5).max(900).optional(),
});

// LLM-шлюз для машины диспетчера (/api/agent/...llm/v1/...). Монтируется ДО общего
// express.json (лимит 256kb), тела читает сам.
// - responses: Responses API для codex (свой model_provider с base_url сюда и токеном воркера
//   вместо ключа). Сервер подставляет токены подписки и проксирует поток, проверяя вызовы
//   команд модели (заголовки x-pf-model и x-pf-workspace-root задаёт Ralph в конфиге codex).
// - generate: короткое задание «текст на входе — текст на выходе» для скриптов Ralph.
export function llmGatewayRouter(deps: Deps): Router {
  const router = Router();
  const billing = new Map<string, { userId: string; at: number }>();

  async function billedUserFor(req: Request): Promise<string> {
    const token = req.agentToken!;
    const caller = req.user!.id;
    if (!token.taskId) return caller;
    const cached = billing.get(token.taskId);
    if (cached && Date.now() - cached.at < BILLING_CACHE_TTL_MS) return cached.userId;
    // Работа по задаче записывается на её создателя (как и LIVE-расход), иначе на диспетчера.
    const task = await deps.tasks.getById(token.taskId).catch(() => null);
    const userId = task?.createdBy ?? caller;
    billing.set(token.taskId, { userId, at: Date.now() });
    return userId;
  }

  // Токен воркера привязан к проекту: пускаем только по его собственному пути.
  function rejectForeignProject(req: Request, res: Response): boolean {
    const token = req.agentToken!;
    const projectId = req.params['projectId'] ?? null;
    if (token.scopeKind === 'project' && projectId !== token.projectId) {
      res.status(403).json({ error: { type: 'agent_project_scope_violation', message: 'Токен воркера выдан для другого проекта' } });
      return true;
    }
    return false;
  }

  function abortOnClose(res: Response): AbortController {
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) controller.abort();
    });
    return controller;
  }

  router.post(
    PATHS,
    express.raw({ type: () => true, limit: MAX_BODY }),
    requireAgentToken(deps.authenticate),
    async (req: Request, res: Response, next: NextFunction) => {
      if (rejectForeignProject(req, res)) return;
      const controller = abortOnClose(res);

      try {
        const headers: Record<string, string> = {};
        for (const [name, value] of Object.entries(req.headers)) {
          if (typeof value === 'string') headers[name.toLowerCase()] = value;
        }
        const upstreamModel = headers['x-pf-model']?.trim() ?? '';
        const upstream = await deps.gateway.forward({
          billedUserId: await billedUserFor(req),
          subpath: req.path.endsWith('/compact') ? '/compact' : '',
          body: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
          headers,
          upstreamModel: isValidLlmModelName(upstreamModel) ? upstreamModel : null,
          workspaceRoot: decodeWorkspaceRoot(headers['x-pf-workspace-root']),
          signal: controller.signal,
        });
        res.status(upstream.status);
        for (const [name, value] of Object.entries(upstream.headers)) res.setHeader(name, value);
        res.setHeader('Cache-Control', 'no-store, private');
        if (!upstream.body) {
          res.end();
          return;
        }
        const stream = Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream<Uint8Array>);
        stream.on('error', () => {
          if (!res.headersSent) res.status(502);
          res.end();
        });
        stream.pipe(res);
      } catch (e) {
        if (res.headersSent) {
          res.end();
          return;
        }
        const mapped = mapGatewayError(e);
        if (!mapped) {
          next(e);
          return;
        }
        res.status(mapped.status).json({ error: mapped.error });
      }
    },
  );

  router.post(
    TEXT_PATHS,
    express.json({ limit: MAX_TEXT_BODY }),
    requireAgentToken(deps.authenticate),
    async (req: Request, res: Response, next: NextFunction) => {
      if (rejectForeignProject(req, res)) return;
      const parsed = textSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { type: 'invalid_request', message: parsed.error.issues[0]?.message ?? 'Некорректный запрос' } });
        return;
      }
      const controller = abortOnClose(res);
      const body = parsed.data;
      try {
        const result = await deps.text.generate({
          billedUserId: await billedUserFor(req),
          tier: body.tier ?? 'default',
          instructions: body.instructions ?? RUN_PROMPT_INSTRUCTIONS,
          input: body.input,
          reasoningEffort: body.reasoningEffort,
          timeoutMs: (body.timeoutSec ?? DEFAULT_TEXT_TIMEOUT_SEC) * 1000,
          signal: controller.signal,
        });
        res.json({ text: result.text, model: result.model, usage: result.usage, costUsd: result.costUsd });
      } catch (e) {
        const mapped = mapGatewayError(e);
        if (!mapped) {
          next(e);
          return;
        }
        res.status(mapped.status).json({ error: mapped.error });
      }
    },
  );

  return router;
}

// Ralph кодирует путь (encodeURIComponent): в заголовке HTTP допустим только ASCII.
function decodeWorkspaceRoot(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const decoded = decodeURIComponent(raw).trim();
    return decoded || null;
  } catch {
    return null;
  }
}

// Ошибки в формате OpenAI: codex показывает error.message, а usage_limit_reached с
// resets_at превращает в своё сообщение «лимит, попробуйте после …».
function mapGatewayError(e: unknown): { status: number; error: Record<string, unknown> } | null {
  if (e instanceof LlmRateLimitedError) {
    return {
      status: 429,
      error: {
        type: 'usage_limit_reached',
        message: e.message,
        ...(e.resetsAt ? { resets_at: Math.floor(e.resetsAt.getTime() / 1000) } : {}),
      },
    };
  }
  if (e instanceof LlmNotConnectedError) return { status: 503, error: { type: 'llm_not_connected', message: e.message } };
  if (e instanceof LlmReauthRequiredError) return { status: 503, error: { type: 'llm_reauth_required', message: e.message } };
  if (e instanceof LlmUpstreamBlockedError) return { status: 502, error: { type: 'llm_upstream_blocked', message: e.message } };
  if (e instanceof LlmUpstreamError) return { status: 502, error: { type: 'llm_upstream_error', message: e.message } };
  if (e instanceof LlmEmptyResponseError) return { status: 502, error: { type: 'llm_empty_response', message: e.message } };
  return null;
}
