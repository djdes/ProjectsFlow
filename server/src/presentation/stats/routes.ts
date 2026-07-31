import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type { CountMyCompletedToday } from '../../application/stats/CountMyCompletedToday.js';
import type { ListUnreadTasks } from '../../application/task/ListUnreadTasks.js';
import { requireAuth } from '../middleware/requireAuth.js';

type Deps = {
  readonly countMyCompletedToday: CountMyCompletedToday;
  readonly listUnreadTasks: ListUnreadTasks;
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

  // Непрочитанные задачи: назначены на caller'а и ни разу им не открыты. Отдаём только id —
  // сами задачи у клиента уже есть из списков, а так эндпоинт остаётся дешёвым и его можно
  // звать на каждой странице.
  r.get('/unread-tasks', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const taskIds = await deps.listUnreadTasks.execute(req.user!.id);
      res.json({ taskIds });
    } catch (e) {
      next(e);
    }
  });

  return r;
}
