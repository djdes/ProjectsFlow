import { Router, type NextFunction, type Request, type Response } from 'express';
import type { SearchTasks } from '../../application/task/SearchTasks.js';
import { requireAuth } from '../middleware/requireAuth.js';

type Deps = {
  readonly searchTasks: SearchTasks;
};

// Глобальный поиск по задачам. Обычный юзер — по своим проектам; admin — по всем.
export function searchRouter(deps: Deps): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/tasks', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = typeof req.query['q'] === 'string' ? req.query['q'] : '';
      const results = await deps.searchTasks.execute(req.user!.id, q, {
        isAdmin: req.user!.isAdmin,
      });
      res.json({ results });
    } catch (e) {
      next(e);
    }
  });

  return router;
}
