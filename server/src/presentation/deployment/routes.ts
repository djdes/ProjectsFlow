import { Router } from 'express';
import type { GetDeploymentStatus } from '../../application/deployment/GetDeploymentStatus.js';
import { requireAuth } from '../middleware/requireAuth.js';

export function deploymentRouter(status: Pick<GetDeploymentStatus, 'execute'>): Router {
  const router = Router();
  router.get('/', requireAuth, async (_req, res, next) => {
    try {
      res.set('Cache-Control', 'private, no-store');
      res.json(await status.execute());
    } catch (error) { next(error); }
  });
  return router;
}
