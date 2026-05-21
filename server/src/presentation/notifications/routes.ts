import { Router, type NextFunction, type Request, type Response } from 'express';
import type { ListNotifications } from '../../application/notifications/ListNotifications.js';
import type { CountUnreadNotifications } from '../../application/notifications/CountUnreadNotifications.js';
import type { MarkNotificationRead } from '../../application/notifications/MarkNotificationRead.js';
import type { MarkAllNotificationsRead } from '../../application/notifications/MarkAllNotificationsRead.js';
import type { Notification } from '../../domain/notifications/Notification.js';
import { requireAuth } from '../middleware/requireAuth.js';

type Deps = {
  readonly list: ListNotifications;
  readonly countUnread: CountUnreadNotifications;
  readonly markRead: MarkNotificationRead;
  readonly markAllRead: MarkAllNotificationsRead;
};

type NotificationDto = Omit<Notification, 'createdAt' | 'readAt'> & {
  createdAt: string;
  readAt: string | null;
};

function toDto(n: Notification): NotificationDto {
  return {
    ...n,
    createdAt: n.createdAt.toISOString(),
    readAt: n.readAt?.toISOString() ?? null,
  };
}

export function notificationsRouter(deps: Deps): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const unreadOnly = req.query['unread'] === '1' || req.query['unread'] === 'true';
      const limitParam = Number(req.query['limit'] ?? 50);
      const limit = Number.isFinite(limitParam) ? limitParam : 50;
      const list = await deps.list.execute({
        userId: req.user!.id,
        unreadOnly,
        limit,
      });
      res.json({ notifications: list.map(toDto) });
    } catch (e) {
      next(e);
    }
  });

  router.get('/unread-count', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const count = await deps.countUnread.execute(req.user!.id);
      res.json({ count });
    } catch (e) {
      next(e);
    }
  });

  router.post('/:id/read', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params['id'];
      if (typeof id !== 'string') {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      await deps.markRead.execute(id, req.user!.id);
      // Idempotent: 204 даже если запись уже была прочитана / не существует.
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  router.post('/read-all', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const affected = await deps.markAllRead.execute(req.user!.id);
      res.json({ updated: affected });
    } catch (e) {
      next(e);
    }
  });

  return router;
}
