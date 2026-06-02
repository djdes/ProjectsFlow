import { Router, type NextFunction, type Request, type Response } from 'express';
import type { ListServers } from '../../application/monitoring/ListServers.js';
import type { ManageServers } from '../../application/monitoring/ManageServers.js';
import type { MonitoringQueries } from '../../application/monitoring/MonitoringQueries.js';
import type { ManageAlertRules } from '../../application/monitoring/ManageAlertRules.js';
import type { GetMonitoringOverview } from '../../application/monitoring/GetMonitoringOverview.js';
import { requireAuth } from '../middleware/requireAuth.js';
import {
  alertRulesSchema,
  historyQuerySchema,
  logKindSchema,
  muteSchema,
  serverConfigSchema,
  LOG_KIND_TO_KEY,
} from './schemas.js';

type Deps = {
  readonly listServers: ListServers;
  readonly manageServers: ManageServers;
  readonly queries: MonitoringQueries;
  readonly manageAlertRules: ManageAlertRules;
};

// Session-роутер мониторинга, монтируется на /api/projects/:projectId/monitoring.
// Чтение — view_monitoring (любой участник), мутации — manage_monitoring (editor+);
// гейты внутри use-case'ов.
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

  // Пороги алертов (per-project). GET — view, PUT — manage.
  router.get('/alert-rules', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rules = await deps.manageAlertRules.get(pid(req), req.user!.id);
      res.json({ rules });
    } catch (e) {
      next(e);
    }
  });

  router.put('/alert-rules', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = alertRulesSchema.parse(req.body);
      const rules = await deps.manageAlertRules.save(pid(req), req.user!.id, [...body.rules]);
      res.json({ rules });
    } catch (e) {
      next(e);
    }
  });

  // «Тихий час» — заглушить уведомления по серверу на N минут (manage).
  router.post('/servers/:serverId/mute', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = muteSchema.parse(req.body);
      const server = await deps.manageServers.setMute(
        pid(req),
        req.params['serverId'] as string,
        req.user!.id,
        body.minutes,
      );
      res.json({ server });
    } catch (e) {
      next(e);
    }
  });

  return router;
}

// Глобальный (кросс-проектный) роутер сводки. Монтируется на /api/monitoring.
export function monitoringOverviewRouter(deps: { overview: GetMonitoringOverview }): Router {
  const router = Router();
  router.use(requireAuth);
  router.get('/overview', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projects = await deps.overview.execute(req.user!.id);
      res.json({ projects });
    } catch (e) {
      next(e);
    }
  });
  return router;
}
