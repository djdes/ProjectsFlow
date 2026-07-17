import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAgentToken } from '../middleware/requireAgentToken.js';
import { requireAgentCapabilityScope } from '../middleware/requireAgentCapabilityScope.js';
import type { AuthenticateAgentToken } from '../../application/agent/AuthenticateAgentToken.js';
import type { ProvisionAppBackend } from '../../application/app-backend/ProvisionAppBackend.js';

export type AppBackendAgentRouterDeps = {
  readonly authenticate: AuthenticateAgentToken;
  readonly provision: ProvisionAppBackend;
};

// Провижининг бэкенда приложения ВОРКЕРОМ (Bearer agent-token). Диспетчер объявляет схему
// сгенерированного приложения → создаётся per-project SQLite + реестр active, возвращается
// app-ключ (ОДИН раз — храним только хеш). Авторизация «назначенный диспетчер» — внутри
// ProvisionAppBackend. Маунтится под /api/agent (рядом с siteAgentRouter).
export function appBackendAgentRouter(deps: AppBackendAgentRouterDeps): Router {
  const router = Router();
  router.use(requireAgentToken(deps.authenticate));
  router.use(requireAgentCapabilityScope());

  router.post(
    '/projects/:projectId/app-backend',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { appKey } = await deps.provision.execute({
          projectId: req.params['projectId'] as string,
          callerUserId: req.user!.id,
          rawSchema: req.body?.schema,
        });
        res.status(200).json({ appKey, status: 'active' });
      } catch (e) {
        next(e);
      }
    },
  );

  return router;
}
