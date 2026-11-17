import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type { ManagePushSubscriptions } from '../../application/push/ManagePushSubscriptions.js';
import type { PushNotificationDispatcher } from '../../application/push/PushNotificationDispatcher.js';
import { PUSH_ENDPOINT_MAX_LENGTH } from '../../domain/push/PushSubscription.js';
import { PushEndpointNotSupportedError } from '../../domain/push/errors.js';
import { requireAuth } from '../middleware/requireAuth.js';

type Deps = {
  readonly manage: ManagePushSubscriptions;
  readonly tester: Pick<PushNotificationDispatcher, 'sendTest'>;
};

const base64Url = (max: number) => z.string().trim().min(1).max(max).regex(/^[A-Za-z0-9_-]+={0,2}$/u);
const endpointSchema = z.string().trim().min(1).max(PUSH_ENDPOINT_MAX_LENGTH).regex(/^https:\/\/[\x21-\x7e]+$/u);

// The body is the browser's PushSubscription.toJSON().
const subscribeSchema = z.object({
  endpoint: endpointSchema,
  keys: z.object({ p256dh: base64Url(255), auth: base64Url(255) }),
});

// /api/push: "notifications on this device" (db/184). Cookie session only.
export function pushRouter(deps: Deps): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/public-key', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.set('Cache-Control', 'private, no-store').json({ publicKey: await deps.manage.publicKey() });
    } catch (e) {
      next(e);
    }
  });

  router.post('/subscriptions', async (req: Request, res: Response, next: NextFunction) => {
    try {
      // An admin signed in as someone else must not receive that person's notifications on
      // their own device.
      if (req.impersonatedBy) {
        res.status(403).json({
          error: 'impersonation_forbidden',
          message: 'Во время входа от имени пользователя уведомления на устройство не включаются',
        });
        return;
      }
      const body = subscribeSchema.parse(req.body);
      await deps.manage.subscribe({
        userId: req.user!.id,
        endpoint: body.endpoint,
        keys: body.keys,
        userAgent: req.get('user-agent')?.slice(0, 512) ?? null,
      });
      res.status(204).end();
    } catch (e) {
      if (e instanceof PushEndpointNotSupportedError) {
        res.status(400).json({
          error: 'push_service_not_supported',
          message: 'Этот браузер использует неизвестный сервис уведомлений',
        });
        return;
      }
      next(e);
    }
  });

  // The endpoint comes in the body (as the browser reports it) or in ?endpoint=.
  router.delete('/subscriptions', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const raw = (req.body as { endpoint?: unknown } | undefined)?.endpoint ?? req.query['endpoint'];
      const endpoint = endpointSchema.parse(raw);
      await deps.manage.unsubscribe(req.user!.id, endpoint);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  // A test push to this device (the profile "send a test" button).
  router.post('/test', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { endpoint } = z.object({ endpoint: endpointSchema }).parse(req.body);
      const result = await deps.tester.sendTest(req.user!.id, endpoint);
      if (result.sent > 0) {
        res.status(204).end();
        return;
      }
      if (result.failed > 0) {
        res.status(502).json({ error: 'push_failed', message: 'Сервис уведомлений не принял сообщение. Попробуйте позже.' });
        return;
      }
      res.status(404).json({
        error: 'subscription_not_found',
        message: 'Это устройство не подписано. Выключите и снова включите уведомления.',
      });
    } catch (e) {
      next(e);
    }
  });

  return router;
}
