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

const enqueueBodySchema = z.object({
  text: z.string().trim().min(1, 'text must be 1..5000 chars').max(5000, 'text must be 1..5000 chars'),
  projectId: z
    .string()
    .uuid('projectId must be uuid')
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  // 'improve' (legacy, default) | 'compose' (2 варианта + разбивка по проектам).
  mode: z.enum(['improve', 'compose']).optional(),
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
