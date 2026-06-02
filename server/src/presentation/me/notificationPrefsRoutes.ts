import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import type { UserRepository } from '../../application/user/UserRepository.js';
import type { ProjectMemberRepository } from '../../application/project/ProjectMemberRepository.js';
import { NOTIF_EVENT_TYPES, type NotifEventType } from '../../domain/notifications/NotificationPrefs.js';

// Источник правды по типам — domain NOTIF_EVENT_TYPES (включая 'server_alert'); не дублируем.
const notificationPrefsSchema = z.record(
  z.enum(NOTIF_EVENT_TYPES as unknown as [NotifEventType, ...NotifEventType[]]),
  z.object({ team: z.boolean(), mcp: z.boolean() }),
);

type Deps = {
  readonly users: UserRepository;
  readonly members: ProjectMemberRepository;
};

export function meNotificationPrefsRouter(deps: Deps): Router {
  const router = Router();
  router.use(requireAuth);

  // GET /me/notification-prefs — глобальные дефолты
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const prefs = await deps.users.getDefaultNotificationPrefs(req.user!.id);
      res.json({ prefs: prefs ?? {} });
    } catch (e) {
      next(e);
    }
  });

  // PUT /me/notification-prefs — установить глобальные дефолты
  router.put('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const prefs = notificationPrefsSchema.parse(req.body?.prefs ?? req.body);
      await deps.users.setDefaultNotificationPrefs(req.user!.id, prefs);
      res.json({ prefs });
    } catch (e) {
      next(e);
    }
  });

  // POST /me/notification-prefs/apply-all — применить дефолты ко всем текущим проектам
  router.post('/apply-all', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const prefs = await deps.users.getDefaultNotificationPrefs(req.user!.id);
      if (!prefs || Object.keys(prefs).length === 0) {
        res.json({ applied: 0 });
        return;
      }
      const projects = await deps.members.listProjectsForUser(req.user!.id);
      let applied = 0;
      for (const p of projects) {
        await deps.members.setNotificationPrefs(p.id, req.user!.id, prefs);
        applied++;
      }
      res.json({ applied });
    } catch (e) {
      next(e);
    }
  });

  return router;
}
