import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import type { GetAppTraffic } from '../../application/app-backend/GetAppTraffic.js';

export type AppTrafficRouterDeps = {
  readonly getAppTraffic: GetAppTraffic;
};

// Клиентское чтение трафика опубликованного приложения (cookie-auth, member проекта). Маунтится
// под /api/projects. Отдаёт только агрегаты (временные ряды + грубые корзины) — см. GetAppTraffic.
export function appTrafficRouter(deps: AppTrafficRouterDeps): Router {
  const router = Router();

  router.get(
    '/:projectId/app-traffic',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const days = Number(req.query['days']);
        res.status(200).json(await deps.getAppTraffic.get(
          req.params['projectId'] as string,
          req.user!.id,
          Number.isFinite(days) ? days : undefined,
        ));
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
