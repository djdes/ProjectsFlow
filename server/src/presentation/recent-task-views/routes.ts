import { Router, type NextFunction, type Request, type Response } from 'express';
import type { ListRecentTaskViews } from '../../application/task/ListRecentTaskViews.js';
import type { RecordTaskView } from '../../application/task/RecordTaskView.js';
import type { RecentTaskView } from '../../domain/task/RecentTaskView.js';
import { requireAuth } from '../middleware/requireAuth.js';

type Deps = {
  readonly list: ListRecentTaskViews;
  readonly record: RecordTaskView;
};

type RecentTaskViewDto = Omit<RecentTaskView, 'viewedAt'> & { viewedAt: string };

function toDto(v: RecentTaskView): RecentTaskViewDto {
  return { ...v, viewedAt: v.viewedAt.toISOString() };
}

export function recentTaskViewsRouter(deps: Deps): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limitParam = Number(req.query['limit'] ?? 3);
      const limit = Number.isFinite(limitParam) ? limitParam : 3;
      const list = await deps.list.execute(req.user!.id, limit);
      res.json({ recent: list.map(toDto) });
    } catch (e) {
      next(e);
    }
  });

  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const taskId = (req.body as { taskId?: unknown } | null)?.taskId;
      if (typeof taskId !== 'string' || taskId.length === 0) {
        res.status(400).json({ error: 'task_id_required' });
        return;
      }
      await deps.record.execute(req.user!.id, taskId);
      // Идемпотентно и fire-and-forget со стороны клиента — отдаём 204.
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  return router;
}
