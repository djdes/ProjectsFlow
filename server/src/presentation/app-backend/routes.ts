import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import type { GetAppBackendStatus } from '../../application/app-backend/GetAppBackendStatus.js';
import type {
  AppRowsQuery,
  ManageAppBackendData,
} from '../../application/app-backend/ManageAppBackendData.js';
import type { ManageAppDashboardSettings } from '../../application/app-backend/AppDashboardSettings.js';

export type AppBackendRouterDeps = {
  readonly getStatus: GetAppBackendStatus;
  readonly dashboard: ManageAppBackendData;
  readonly settings: ManageAppDashboardSettings;
};

// Клиентское чтение статуса бэкенда приложения (cookie-auth, member проекта): включён ли,
// usage/лимит, таблицы. Для UI-индикатора «app с бэкендом — X/100 МБ». Маунтится под /api/projects.
export function appBackendRouter(deps: AppBackendRouterDeps): Router {
  const router = Router();

  router.get('/:projectId/app-dashboard/settings', requireAuth, async (req, res, next) => {
    try {
      res.status(200).json(await deps.settings.get(req.params['projectId'] as string, req.user!.id));
    } catch (error) { next(error); }
  });

  router.put('/:projectId/app-dashboard/settings', requireAuth, async (req, res, next) => {
    try {
      res.status(200).json(await deps.settings.update(req.params['projectId'] as string, req.user!.id, req.body));
    } catch (error) { next(error); }
  });

  router.post('/:projectId/app-dashboard/domains/verify', requireAuth, async (req, res, next) => {
    try {
      res.status(200).json(await deps.settings.verifyCustomDomain(req.params['projectId'] as string, req.user!.id));
    } catch (error) { next(error); }
  });

  router.post('/:projectId/app-dashboard/integrations/webhooks/test', requireAuth, async (req, res, next) => {
    try {
      res.status(200).json(await deps.settings.testWebhook(req.params['projectId'] as string, req.user!.id));
    } catch (error) { next(error); }
  });

  router.post('/:projectId/app-dashboard/security/scan', requireAuth, async (req, res, next) => {
    try {
      res.status(200).json(await deps.settings.scanSecurity(req.params['projectId'] as string, req.user!.id));
    } catch (error) { next(error); }
  });

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

  router.get(
    '/:projectId/app-backend/dashboard',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        res.status(200).json(await deps.dashboard.getDashboard(
          req.params['projectId'] as string,
          req.user!.id,
        ));
      } catch (error) {
        next(error);
      }
    },
  );

  router.get('/:projectId/app-backend/users', requireAuth, async (req, res, next) => {
    try { res.status(200).json({ users: await deps.dashboard.listRuntimeUsers(req.params['projectId'] as string, req.user!.id) }); }
    catch (error) { next(error); }
  });

  router.post('/:projectId/app-backend/users/:userId/revoke-sessions', requireAuth, async (req, res, next) => {
    try { res.status(200).json(await deps.dashboard.revokeRuntimeUserSessions(req.params['projectId'] as string, req.user!.id, req.params['userId'] as string)); }
    catch (error) { next(error); }
  });

  router.delete('/:projectId/app-backend/users/:userId', requireAuth, async (req, res, next) => {
    try { res.status(200).json(await deps.dashboard.deleteRuntimeUser(req.params['projectId'] as string, req.user!.id, req.params['userId'] as string)); }
    catch (error) { next(error); }
  });

  router.post(
    '/:projectId/app-backend/tables/:table/query',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = req.body && typeof req.body === 'object' ? req.body as AppRowsQuery : {};
        res.status(200).json(await deps.dashboard.listRows(
          req.params['projectId'] as string,
          req.user!.id,
          req.params['table'] as string,
          body,
        ));
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/:projectId/app-backend/tables/:table/rows',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = req.body && typeof req.body === 'object'
          ? req.body as { values?: unknown }
          : {};
        const row = await deps.dashboard.insertRow(
          req.params['projectId'] as string,
          req.user!.id,
          req.params['table'] as string,
          body.values,
        );
        res.status(201).json({ row });
      } catch (error) {
        next(error);
      }
    },
  );

  router.patch(
    '/:projectId/app-backend/tables/:table/rows/:rowId',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = req.body && typeof req.body === 'object'
          ? req.body as { values?: unknown }
          : {};
        const row = await deps.dashboard.updateRow(
          req.params['projectId'] as string,
          req.user!.id,
          req.params['table'] as string,
          req.params['rowId'] as string,
          body.values,
        );
        res.status(200).json({ row });
      } catch (error) {
        next(error);
      }
    },
  );

  router.delete(
    '/:projectId/app-backend/tables/:table/rows/:rowId',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        res.status(200).json(await deps.dashboard.deleteRow(
          req.params['projectId'] as string,
          req.user!.id,
          req.params['table'] as string,
          req.params['rowId'] as string,
        ));
      } catch (error) {
        next(error);
      }
    },
  );

  router.put(
    '/:projectId/app-backend/tables/:table/permissions',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        res.status(200).json({ rules: await deps.dashboard.updateRules(
          req.params['projectId'] as string,
          req.user!.id,
          req.params['table'] as string,
          req.body,
        ) });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    '/:projectId/app-backend/logs',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const numberParam = (value: unknown): number | undefined => {
          const parsed = Number(value);
          return Number.isFinite(parsed) ? parsed : undefined;
        };
        res.status(200).json(await deps.dashboard.listLogs(
          req.params['projectId'] as string,
          req.user!.id,
          {
            tableName: typeof req.query['table'] === 'string' ? req.query['table'] : undefined,
            operation: typeof req.query['operation'] === 'string' ? req.query['operation'] : undefined,
            actorId: typeof req.query['actor'] === 'string' ? req.query['actor'] : undefined,
            errorsOnly: req.query['errors'] === '1',
            limit: numberParam(req.query['limit']),
            offset: numberParam(req.query['offset']),
          },
        ));
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
