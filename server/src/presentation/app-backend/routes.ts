import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import type { GetAppBackendStatus } from '../../application/app-backend/GetAppBackendStatus.js';

export type AppBackendRouterDeps = {
  readonly getStatus: GetAppBackendStatus;
};

// Клиентское чтение статуса бэкенда приложения (cookie-auth, member проекта): включён ли,
// usage/лимит, таблицы. Для UI-индикатора «app с бэкендом — X/100 МБ». Маунтится под /api/projects.
export function appBackendRouter(deps: AppBackendRouterDeps): Router {
  const router = Router();

  router.get(
    '/:projectId/app-backend',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const status = await deps.getStatus.execute(req.params['projectId'] as string, req.user!.id);
        res.status(200).json(status);
      } catch (e) {
        next(e);
      }
    },
  );

  return router;
}
