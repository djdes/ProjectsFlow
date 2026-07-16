import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import {
  PRODUCT_ACTIONS,
  type ProductTelemetryRepository,
} from '../../application/telemetry/ProductTelemetryRepository.js';
import { requireAuth } from '../middleware/requireAuth.js';

const actionSchema = z.object({
  projectId: z.string().uuid().nullable().optional(),
  action: z.enum(PRODUCT_ACTIONS),
  result: z.enum(['started', 'success', 'failure']),
  durationMs: z.number().int().min(0).max(86_400_000).nullable().optional(),
});

export function telemetryRouter(deps: { readonly repo: ProductTelemetryRepository }): Router {
  const router = Router();
  router.use(requireAuth);
  router.post('/actions', async (req, res, next) => {
    try {
      const body = actionSchema.parse(req.body);
      await deps.repo.record({
        id: randomUUID(),
        userId: req.user!.id,
        projectId: body.projectId ?? null,
        action: body.action,
        result: body.result,
        durationMs: body.durationMs ?? null,
      });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });
  return router;
}
