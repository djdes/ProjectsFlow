import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type { EnqueueMonitoringAnalysisJob } from '../../application/monitoring-analysis/EnqueueMonitoringAnalysisJob.js';
import { MonitoringAnalysisRateLimitedError } from '../../application/monitoring-analysis/EnqueueMonitoringAnalysisJob.js';
import type { WaitForMonitoringAnalysisJob } from '../../application/monitoring-analysis/WaitForMonitoringAnalysisJob.js';
import type { ListServerAnalysisHistory } from '../../application/monitoring-analysis/ListServerAnalysisHistory.js';
import type { MonitoringAnalysisJob } from '../../domain/monitoring-analysis/MonitoringAnalysisJob.js';
import {
  MonitoringAnalysisJobAccessDeniedError,
  MonitoringAnalysisJobNotFoundError,
  MonitoringAnalysisProjectHasNoDispatcherError,
} from '../../domain/monitoring-analysis/errors.js';
import { ServerNotFoundError } from '../../domain/monitoring/errors.js';
import { requireAuth } from '../middleware/requireAuth.js';

const enqueueSchema = z.object({
  projectId: z.string().uuid(),
  serverId: z.string().uuid(),
  analysisType: z.enum(['snapshot', 'logs', 'alert', 'digest']).optional(),
  alertId: z.string().uuid().nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
});

const waitQuerySchema = z.object({
  wait: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 25))
    .pipe(z.number().int().min(1).max(60)),
});

const historyQuerySchema = z.object({
  projectId: z.string().uuid(),
  serverId: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

type Deps = {
  readonly enqueue: EnqueueMonitoringAnalysisJob;
  readonly waitFor: WaitForMonitoringAnalysisJob;
  readonly history: ListServerAnalysisHistory;
};

function jobToDto(j: MonitoringAnalysisJob): Record<string, unknown> {
  return {
    jobId: j.id,
    serverId: j.serverId,
    status: j.status,
    analysisType: j.analysisType,
    resultMarkdown: j.resultMarkdown,
    error: j.error,
    costUsd: j.costUsd,
    createdAt: j.createdAt.toISOString(),
    finishedAt: j.finishedAt ? j.finishedAt.toISOString() : null,
  };
}

// Кросс-проектный (cookie-auth) роутер AI-анализа. Монтируется на /api/monitoring.
export function monitoringAnalysisRouter(deps: Deps): Router {
  const router = Router();
  router.use(requireAuth);

  // POST /api/monitoring/analysis-jobs — поставить анализ в очередь (manage_monitoring внутри).
  router.post('/analysis-jobs', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = enqueueSchema.parse(req.body);
      const job = await deps.enqueue.execute({
        userId: req.user!.id,
        projectId: body.projectId,
        serverId: body.serverId,
        analysisType: body.analysisType,
        alertId: body.alertId ?? null,
        note: body.note ?? null,
      });
      res.status(201).json({ jobId: job.id, status: job.status, analysisType: job.analysisType });
    } catch (e) {
      if (e instanceof MonitoringAnalysisRateLimitedError) {
        res.status(429).json({ error: 'rate_limited', message: e.message });
        return;
      }
      if (e instanceof MonitoringAnalysisProjectHasNoDispatcherError) {
        res.status(503).json({
          error: 'no_dispatcher_for_project',
          message: 'У проекта не назначен диспетчер для AI-анализа',
        });
        return;
      }
      if (e instanceof ServerNotFoundError) {
        res.status(404).json({ error: 'server_not_found' });
        return;
      }
      next(e);
    }
  });

  // GET /api/monitoring/analysis-jobs/:jobId?wait=25 — long-poll результата (200/504).
  router.get('/analysis-jobs/:jobId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const jobId = req.params['jobId'] as string;
      const { wait } = waitQuerySchema.parse(req.query);
      const job = await deps.waitFor.execute({ userId: req.user!.id, jobId, maxWaitMs: wait * 1000 });
      if (job === null) {
        res.status(504).json({ error: 'timeout', jobId, status: 'queued' });
        return;
      }
      res.json(jobToDto(job));
    } catch (e) {
      if (e instanceof MonitoringAnalysisJobNotFoundError) {
        res.status(404).json({ error: 'job_not_found' });
        return;
      }
      if (e instanceof MonitoringAnalysisJobAccessDeniedError) {
        res.status(403).json({ error: 'not_owner' });
        return;
      }
      next(e);
    }
  });

  // GET /api/monitoring/analysis-history?projectId=&serverId=&limit= — история анализов сервера.
  router.get('/analysis-history', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = historyQuerySchema.parse(req.query);
      const jobs = await deps.history.execute({
        userId: req.user!.id,
        projectId: q.projectId,
        serverId: q.serverId,
        limit: q.limit,
      });
      res.json({ jobs: jobs.map(jobToDto) });
    } catch (e) {
      if (e instanceof ServerNotFoundError) {
        res.status(404).json({ error: 'server_not_found' });
        return;
      }
      next(e);
    }
  });

  return router;
}
