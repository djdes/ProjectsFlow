import { Router, type NextFunction, type Request, type Response } from 'express';
import type { AuthenticateAgentToken } from '../../application/agent/AuthenticateAgentToken.js';
import type { SiteEditorService } from '../../application/site-editor/SiteEditorService.js';
import { requireAgentCapabilityScope } from '../middleware/requireAgentCapabilityScope.js';
import { requireAgentToken } from '../middleware/requireAgentToken.js';
import { claimJobSchema, completeJobSchema } from './schemas.js';
import { handleSiteEditorError } from './routes.js';

type Deps = {
  readonly authenticate: AuthenticateAgentToken;
  readonly service: SiteEditorService;
};

export function siteEditorAgentRouter(deps: Deps): Router {
  const router = Router();
  router.use(requireAgentToken(deps.authenticate));
  router.use(requireAgentCapabilityScope());

  // Глобальная очередь — то, что реально поллит раннер (по образцу /pending-ai-prompt-jobs).
  // Per-project вариант ниже оставлен для точечных запросов, но полагаться на него нельзя:
  // раннер не обходит проекты по одному, и именно из-за этого publish-job'ы висели в queued.
  router.get('/pending-site-editor-jobs', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawLimit = Number(req.query['limit'] ?? 20);
      const jobs = await deps.service.listQueuedJobsForDispatcher(
        req.user!.id,
        Number.isFinite(rawLimit) ? rawLimit : 20,
      );
      res.json({ jobs });
    } catch (error) { handleSiteEditorError(error, res, next); }
  });

  router.get('/projects/:projectId/site-editor/jobs/pending', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawLimit = Number(req.query['limit'] ?? 20);
      const jobs = await deps.service.listQueuedJobs(
        req.params.projectId as string,
        req.user!.id,
        Number.isFinite(rawLimit) ? rawLimit : 20,
      );
      res.json({ jobs });
    } catch (error) { handleSiteEditorError(error, res, next); }
  });

  router.get('/projects/:projectId/site-editor/artifact', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const artifactVersion = await deps.service.getArtifactVersionForDispatcher(
        req.params.projectId as string,
        req.user!.id,
      );
      res.json({ artifactVersion });
    } catch (error) { handleSiteEditorError(error, res, next); }
  });

  router.post('/projects/:projectId/site-editor/jobs/:jobId/claim', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = claimJobSchema.parse(req.body);
      const job = await deps.service.claimJob(
        req.params.projectId as string,
        req.user!.id,
        req.params.jobId as string,
        body.artifactVersion,
      );
      res.json({ job });
    } catch (error) { handleSiteEditorError(error, res, next); }
  });

  router.post('/projects/:projectId/site-editor/jobs/:jobId/complete', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = completeJobSchema.parse(req.body);
      const job = await deps.service.completeJob({
        projectId: req.params.projectId as string,
        userId: req.user!.id,
        jobId: req.params.jobId as string,
        ...body,
      });
      res.json({ job });
    } catch (error) { handleSiteEditorError(error, res, next); }
  });

  return router;
}
