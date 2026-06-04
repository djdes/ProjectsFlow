import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import type { GetDigestSettings } from '../../application/digest/GetDigestSettings.js';
import type { SaveDigestSettings } from '../../application/digest/SaveDigestSettings.js';
import type { TriggerDailyDigestNow } from '../../application/digest/TriggerDailyDigestNow.js';

const taskStatusSchema = z.enum([
  'backlog',
  'todo',
  'in_progress',
  'awaiting_clarification',
  'done',
  'manual',
]);

const saveSchema = z.object({
  // chat_id групп отрицательный — поэтому просто int, без min.
  telegramGroupChatId: z.number().int().nullable(),
  telegramGroupTitle: z.string().trim().max(255).nullable(),
  daily: z.object({
    enabled: z.boolean(),
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59),
    recipientUserIds: z.array(z.string().uuid()).max(200),
    channels: z.array(z.enum(['email', 'telegram', 'notification'])).max(3),
    tgTargets: z.array(z.enum(['personal', 'group'])).max(2),
    statuses: z.array(taskStatusSchema).max(6),
  }),
});

type Deps = {
  readonly get: GetDigestSettings;
  readonly save: SaveDigestSettings;
  readonly sendNow: TriggerDailyDigestNow;
};

// Настройки дайджеста проекта: Telegram-группа + ежедневная сводка.
// Монтируется под /api/projects.
export function digestRouter(deps: Deps): Router {
  const router = Router({ mergeParams: true });
  router.use(requireAuth);

  router.get('/:projectId/digest-settings', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const settings = await deps.get.execute(req.params['projectId'] as string, req.user!.id);
      res.json({ settings });
    } catch (e) {
      next(e);
    }
  });

  router.put('/:projectId/digest-settings', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = saveSchema.parse(req.body);
      const settings = await deps.save.execute(req.params['projectId'] as string, req.user!.id, {
        telegramGroupChatId: body.telegramGroupChatId,
        telegramGroupTitle: body.telegramGroupTitle,
        daily: body.daily,
      });
      res.json({ settings });
    } catch (e) {
      next(e);
    }
  });

  // Отправить сводку немедленно (тест) — по текущим сохранённым настройкам.
  router.post('/:projectId/digest-settings/send-now', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await deps.sendNow.execute(req.params['projectId'] as string, req.user!.id);
      res.json(result);
    } catch (e) {
      next(e);
    }
  });

  return router;
}
