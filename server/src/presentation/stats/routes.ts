import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type { CountMyCompletedToday } from '../../application/stats/CountMyCompletedToday.js';
import { requireAuth } from '../middleware/requireAuth.js';

type Deps = {
  readonly countMyCompletedToday: CountMyCompletedToday;
};

// `since` — локальная полночь клиента в ISO. Границу суток считает клиент: сервер не знает
// его таймзону (см. CountMyCompletedToday, там же зажим окна).
const querySchema = z.object({ since: z.string().datetime() });

// Личная статистика caller'а. Отдельный роутер под /api/me: данные кросс-проектные, поэтому
// project-scoped роутеры задач тут не подходят.
export function meStatsRouter(deps: Deps): Router {
  const r = Router();
  r.use(requireAuth);

  r.get('/stats/completed-today', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { since } = querySchema.parse(req.query);
      const count = await deps.countMyCompletedToday.execute(req.user!.id, new Date(since));
      res.json({ count });
    } catch (e) {
      next(e);
    }
  });

  return r;
}
