import { Router, type NextFunction, type Request, type Response } from 'express';
import type { EnqueueAgentJob } from '../../application/agent/EnqueueAgentJob.js';
import type { CancelAgentJob } from '../../application/agent/CancelAgentJob.js';
import type { ListAgentJobsForProject } from '../../application/agent/ListAgentJobsForProject.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { cancelAgentJobBodySchema } from './schemas.js';
import type { AgentJob } from '../../domain/agent/AgentJob.js';

type Deps = {
  readonly enqueueAgentJob: EnqueueAgentJob;
  readonly cancelAgentJob: CancelAgentJob;
  readonly listAgentJobsForProject: ListAgentJobsForProject;
};

export function agentJobToDto(j: AgentJob) {
  return {
    ...j,
    claimedAt: j.claimedAt?.toISOString() ?? null,
    startedAt: j.startedAt?.toISOString() ?? null,
    finishedAt: j.finishedAt?.toISOString() ?? null,
    createdAt: j.createdAt.toISOString(),
    updatedAt: j.updatedAt.toISOString(),
  };
}

export function buildAgentJobsRouter(deps: Deps): Router {
  const r = Router({ mergeParams: true });

  r.post(
    '/projects/:projectId/tasks/:taskId/agent',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const job = await deps.enqueueAgentJob.execute({
          userId: req.user!.id,
          projectId: req.params['projectId'] as string,
          taskId: req.params['taskId'] as string,
        });
        res.status(201).json({ job: agentJobToDto(job) });
      } catch (e) {
        next(e);
      }
    },
  );

  r.delete(
    '/projects/:projectId/agent-jobs/:jobId',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = cancelAgentJobBodySchema.parse(req.body ?? {});
        await deps.cancelAgentJob.execute({
          userId: req.user!.id,
          projectId: req.params['projectId'] as string,
          jobId: req.params['jobId'] as string,
          reason: body.reason,
        });
        res.status(204).end();
      } catch (e) {
        next(e);
      }
    },
  );

  r.get(
    '/projects/:projectId/agent-jobs',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const jobs = await deps.listAgentJobsForProject.execute({
          userId: req.user!.id,
          projectId: req.params['projectId'] as string,
        });
        res.json({ jobs: jobs.map(agentJobToDto) });
      } catch (e) {
        next(e);
      }
    },
  );

  return r;
}
