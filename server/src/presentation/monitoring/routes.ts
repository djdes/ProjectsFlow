import { Router, type NextFunction, type Request, type Response } from 'express';
import type { ListServers } from '../../application/monitoring/ListServers.js';
import type { ManageServers } from '../../application/monitoring/ManageServers.js';
import type { MonitoringQueries } from '../../application/monitoring/MonitoringQueries.js';
import { requireAuth } from '../middleware/requireAuth.js';
import {
  historyQuerySchema,
  logKindSchema,
  serverConfigSchema,
  LOG_KIND_TO_KEY,
} from './schemas.js';

type Deps = {
  readonly listServers: ListServers;
  readonly manageServers: ManageServers;
  readonly queries: MonitoringQueries;
};

// Session-роутер мониторинга, монтируется на /api/projects/:projectId/monitoring.
// Все эндпоинты owner-only (внутри use-case'ов через view_monitoring/manage_monitoring).
export function monitoringRouter(deps: Deps): Router {
  const router = Router({ mergeParams: true });
  router.use(requireAuth);

  const pid = (req: Request): string => req.params['projectId'] as string;

  router.get('/servers', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const servers = await deps.listServers.execute(pid(req), req.user!.id);
      res.json({ servers });
    } catch (e) {
      next(e);
    }
  });

  router.post('/servers', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = serverConfigSchema.parse(req.body);
      const server = await deps.manageServers.create(pid(req), req.user!.id, body);
      res.status(201).json({ server });
    } catch (e) {
      next(e);
    }
  });

  router.patch('/servers/:serverId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = serverConfigSchema.parse(req.body);
      const server = await deps.manageServers.update(
        pid(req),
        req.params['serverId'] as string,
        req.user!.id,
        body,
      );
      res.json({ server });
    } catch (e) {
      next(e);
    }
  });

  router.delete('/servers/:serverId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      await deps.manageServers.remove(pid(req), req.params['serverId'] as string, req.user!.id);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  router.post(
    '/servers/:serverId/collect',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const snapshot = await deps.manageServers.triggerLocalCollect(
          pid(req),
          req.params['serverId'] as string,
          req.user!.id,
        );
        res.json({ snapshot });
      } catch (e) {
        next(e);
      }
    },
  );

  router.get(
    '/servers/:serverId/latest',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const snapshot = await deps.queries.getLatest(
          pid(req),
          req.params['serverId'] as string,
          req.user!.id,
        );
        res.json({ snapshot });
      } catch (e) {
        next(e);
      }
    },
  );

  router.get(
    '/servers/:serverId/history',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const q = historyQuerySchema.parse(req.query);
        const points = await deps.queries.getHistory(
          pid(req),
          req.params['serverId'] as string,
          req.user!.id,
          {
            since: q.since ? new Date(q.since) : undefined,
            until: q.until ? new Date(q.until) : undefined,
            limit: q.limit,
          },
        );
        res.json({ points });
      } catch (e) {
        next(e);
      }
    },
  );

  router.get('/servers/:serverId/logs', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const kind = logKindSchema.parse(req.query['kind']);
      const log = await deps.queries.getLogs(
        pid(req),
        req.params['serverId'] as string,
        req.user!.id,
        LOG_KIND_TO_KEY[kind],
      );
      res.json({ log });
    } catch (e) {
      next(e);
    }
  });

  router.get('/alerts', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const activeOnly = req.query['active'] === '1' || req.query['active'] === 'true';
      const alerts = await deps.queries.listAlerts(pid(req), req.user!.id, activeOnly);
      res.json({ alerts });
    } catch (e) {
      next(e);
    }
  });

  return router;
}
