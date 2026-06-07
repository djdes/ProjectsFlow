import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type { EnqueueAiPromptJob } from '../../application/ai-prompt/EnqueueAiPromptJob.js';
import { AiPromptRateLimitedError } from '../../application/ai-prompt/EnqueueAiPromptJob.js';
import type { WaitForAiPromptJob } from '../../application/ai-prompt/WaitForAiPromptJob.js';
import type { AiPromptJob } from '../../domain/ai-prompt/AiPromptJob.js';
import {
  AiPromptDispatcherNotConfiguredError,
  AiPromptJobAccessDeniedError,
  AiPromptJobNotFoundError,
  AiPromptProjectHasNoDispatcherError,
} from '../../domain/ai-prompt/errors.js';
import { requireAuth } from '../middleware/requireAuth.js';

// Свободный текст пользователя (improve / compose pass-1) — до 50000 символов: совпадает с
// maxLength поля композера и лимитом описания задачи (фактически «без ограничения по объёму»).
// Колонка input_text — MEDIUMTEXT (db/066), так что байтового потолка TEXT больше нет.
const MAX_FREE_TEXT = 50000;
// compose-advanced: в text едет JSON сегментов из pass-1 (не свободный текст). Запас под
// большой черновик: simpleBody всех сегментов + структура. Тоже в MEDIUMTEXT (db/066).
const MAX_ADVANCED_PAYLOAD = 200000;

const enqueueBodySchema = z
  .object({
    text: z.string().trim().min(1, 'text required').max(MAX_ADVANCED_PAYLOAD, 'text too long'),
    projectId: z
      .string()
      .uuid('projectId must be uuid')
      .nullable()
      .optional()
      .transform((v) => v ?? null),
    // 'improve' (legacy, default) | 'compose' (pass-1) | 'compose-advanced' (ленивый pass-2).
    mode: z.enum(['improve', 'compose', 'compose-advanced']).optional(),
  })
  .superRefine((b, ctx) => {
    // Лимит свободного текста — только для improve/compose; advanced (JSON сегментов) шире.
    if (b.mode !== 'compose-advanced' && b.text.length > MAX_FREE_TEXT) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['text'],
        message: `text must be 1..${MAX_FREE_TEXT} chars`,
      });
    }
  });

const waitQuerySchema = z.object({
  wait: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 25))
    .pipe(z.number().int().min(1).max(60)),
});

type Deps = {
  readonly enqueueAiPromptJob: EnqueueAiPromptJob;
  readonly waitForAiPromptJob: WaitForAiPromptJob;
};

export function buildAiPromptRouter(deps: Deps): Router {
  const r = Router();

  // POST /api/ai/prompt-jobs — создать job. Body: { text, projectId? }.
  r.post('/ai/prompt-jobs', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = enqueueBodySchema.parse(req.body);
      const job = await deps.enqueueAiPromptJob.execute({
        userId: req.user!.id,
        text: body.text,
        projectId: body.projectId,
        mode: body.mode,
      });
      res.status(201).json({
        jobId: job.id,
        status: job.status,
        mode: job.mode,
        createdAt: job.createdAt.toISOString(),
      });
    } catch (e) {
      if (e instanceof AiPromptRateLimitedError) {
        res.status(429).json({ error: 'rate_limited', message: e.message });
        return;
      }
      if (e instanceof AiPromptDispatcherNotConfiguredError) {
        res.status(503).json({ error: 'ai_not_configured', message: 'AI временно недоступен' });
        return;
      }
      if (e instanceof AiPromptProjectHasNoDispatcherError) {
        res.status(503).json({
          error: 'no_dispatcher_for_project',
          message: 'У проекта не назначен диспетчер для AI-улучшений',
        });
        return;
      }
      next(e);
    }
  });

  // GET /api/ai/prompt-jobs/:jobId?wait=25 — long-poll. 200 при готовности, 504 на таймаут.
  r.get(
    '/ai/prompt-jobs/:jobId',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const jobId = req.params['jobId'] as string;
        const { wait } = waitQuerySchema.parse(req.query);
        const job = await deps.waitForAiPromptJob.execute({
          userId: req.user!.id,
          jobId,
          maxWaitMs: wait * 1000,
        });
        if (job === null) {
          res.status(504).json({ error: 'timeout', jobId, status: 'queued' });
          return;
        }
        res.json(aiPromptJobToDto(job));
      } catch (e) {
        if (e instanceof AiPromptJobNotFoundError) {
          res.status(404).json({ error: 'job_not_found' });
          return;
        }
        if (e instanceof AiPromptJobAccessDeniedError) {
          res.status(403).json({ error: 'not_owner' });
          return;
        }
        next(e);
      }
    },
  );

  return r;
}

function aiPromptJobToDto(job: AiPromptJob): {
  jobId: string;
  status: AiPromptJob['status'];
  mode: AiPromptJob['mode'];
  improvedText: string | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
} {
  return {
    jobId: job.id,
    status: job.status,
    mode: job.mode,
    improvedText: job.improvedText,
    error: job.error,
    createdAt: job.createdAt.toISOString(),
    finishedAt: job.finishedAt ? job.finishedAt.toISOString() : null,
  };
}
