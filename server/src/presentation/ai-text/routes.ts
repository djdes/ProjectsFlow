import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type { AuthenticateAgentToken } from '../../application/agent/AuthenticateAgentToken.js';
import { AiPromptRateLimitedError, type EnqueueAiPromptJob } from '../../application/ai-prompt/EnqueueAiPromptJob.js';
import type { WaitForAiPromptJob } from '../../application/ai-prompt/WaitForAiPromptJob.js';
import type { AiPromptJob } from '../../domain/ai-prompt/AiPromptJob.js';
import {
  AiPromptDispatcherNotConfiguredError,
  AiPromptJobAccessDeniedError,
  AiPromptJobNotFoundError,
} from '../../domain/ai-prompt/errors.js';
import { requireAgentToken } from '../middleware/requireAgentToken.js';
import { requireAuth } from '../middleware/requireAuth.js';

// Текстовый шлюз Codex для любых проектов: «упрости текст», «напиши пост», «сократи».
// POST кладёт job в общую очередь ai_prompt_jobs (mode='text'), диспетчер Ralph исполняет его
// локальным `codex exec` по подписке ChatGPT (ai-job-worker.ps1), клиент забирает результат
// long-poll'ом. Пара к /api/ai/image-jobs: та же авторизация (сессия или account-токен агента).
//
// inputText job'а — JSON-конверт { v: 1, instructions, input }: его разбирает воркер, поэтому
// поля не склеиваются в один промпт на сервере и инструкция не смешивается с данными.

export const MAX_TEXT_INPUT = 100_000;
export const MAX_TEXT_INSTRUCTIONS = 20_000;
export const TEXT_ENVELOPE_VERSION = 1;

const createBodySchema = z
  .object({
    input: z.string().trim().min(1, 'input required').max(MAX_TEXT_INPUT, `input must be 1..${MAX_TEXT_INPUT} chars`),
    instructions: z
      .string()
      .trim()
      .max(MAX_TEXT_INSTRUCTIONS, `instructions must be up to ${MAX_TEXT_INSTRUCTIONS} chars`)
      .optional(),
  })
  .strict();

const waitQuerySchema = z.object({
  wait: z.coerce.number().int().min(0).max(60).default(25),
});

type Deps = {
  readonly enqueueAiPromptJob: Pick<EnqueueAiPromptJob, 'execute'>;
  readonly waitForAiPromptJob: Pick<WaitForAiPromptJob, 'execute'>;
  readonly authenticate?: AuthenticateAgentToken;
};

export function buildTextEnvelope(input: string, instructions?: string): string {
  return JSON.stringify({ v: TEXT_ENVELOPE_VERSION, instructions: instructions ?? '', input });
}

function toDto(job: AiPromptJob) {
  return {
    id: job.id,
    status: job.status,
    text: job.status === 'succeeded' ? job.improvedText : null,
    error: job.error,
    createdAt: job.createdAt.toISOString(),
    finishedAt: job.finishedAt ? job.finishedAt.toISOString() : null,
  };
}

const uuid = z.string().uuid();

export function aiTextJobsRouter(deps: Deps): Router {
  const r = Router();
  if (deps.authenticate) {
    const authenticate = deps.authenticate;
    r.use((req, res, next) => {
      if (!req.headers.authorization) return next();
      return requireAgentToken(authenticate)(req, res, (error?: unknown) => {
        if (error) return next(error);
        if (req.agentToken?.scopeKind !== 'account') {
          res.status(403).json({ error: 'account_token_required' });
          return;
        }
        next();
      });
    });
  }
  r.use(requireAuth);

  // POST /api/ai/text-jobs — { input, instructions? } → 202 { id, status, createdAt }.
  r.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = createBodySchema.parse(req.body);
      const job = await deps.enqueueAiPromptJob.execute({
        userId: req.user!.id,
        text: buildTextEnvelope(body.input, body.instructions),
        projectId: null,
        mode: 'text',
      });
      console.info('[ai-text] queued', {
        jobId: job.id,
        userId: req.user!.id,
        via: req.agentToken ? 'agent-token' : 'session',
        inputChars: body.input.length,
        instructionsChars: body.instructions?.length ?? 0,
      });
      res.status(202).json({ id: job.id, status: job.status, createdAt: job.createdAt.toISOString() });
    } catch (e) {
      if (e instanceof AiPromptRateLimitedError) {
        console.warn('[ai-text] rate limited', { userId: req.user!.id });
        res.status(429).json({ error: 'rate_limited', message: 'Лимит текстовых задач: 300 в час' });
        return;
      }
      if (e instanceof AiPromptDispatcherNotConfiguredError) {
        console.warn('[ai-text] no default dispatcher configured');
        res.status(503).json({ error: 'ai_not_configured', message: 'Текстовый шлюз временно недоступен' });
        return;
      }
      next(e);
    }
  });

  // GET /api/ai/text-jobs/:id?wait=25 — ждёт до wait секунд (0..60) и отдаёт текущее состояние.
  // Всегда 200: клиент повторяет запрос, пока status не станет succeeded | failed | cancelled.
  r.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = uuid.safeParse(req.params['id']);
      if (!id.success) {
        res.status(404).json({ error: 'job_not_found' });
        return;
      }
      const { wait } = waitQuerySchema.parse(req.query);
      const job = await deps.waitForAiPromptJob.execute({
        userId: req.user!.id,
        jobId: id.data,
        maxWaitMs: wait * 1000,
        returnLatestOnTimeout: true,
      });
      // Через этот API видны только text-job'ы: improve/compose живут в своём контуре.
      if (!job || job.mode !== 'text') {
        res.status(404).json({ error: 'job_not_found' });
        return;
      }
      res.set('Cache-Control', 'private, no-store').json(toDto(job));
    } catch (e) {
      if (e instanceof AiPromptJobNotFoundError || e instanceof AiPromptJobAccessDeniedError) {
        // Чужой job неотличим от несуществующего.
        res.status(404).json({ error: 'job_not_found' });
        return;
      }
      next(e);
    }
  });

  return r;
}
