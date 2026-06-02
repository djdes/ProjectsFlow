import { Router, type NextFunction, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import type { UserRepository } from '../../application/user/UserRepository.js';
import { kanbanDefaultColorsSchema } from '../projects/schemas.js';

type Deps = {
  readonly users: UserRepository;
};

// Персональные дефолтные цвета канбан-колонок (профиль). Резолвятся на лету как fallback
// для всех проектов юзера — НЕ копируются в проект при создании (см. resolveColumnColor).
export function meKanbanColorsRouter(deps: Deps): Router {
  const router = Router();
  router.use(requireAuth);

  // GET /me/kanban-colors — текущие дефолты ({} = встроенные).
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const colors = await deps.users.getDefaultKanbanColors(req.user!.id);
      res.json({ colors: colors ?? {} });
    } catch (e) {
      next(e);
    }
  });

  // PUT /me/kanban-colors — установить дефолты.
  router.put('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const colors = kanbanDefaultColorsSchema.parse(req.body?.colors ?? req.body);
      await deps.users.setDefaultKanbanColors(req.user!.id, colors);
      res.json({ colors });
    } catch (e) {
      next(e);
    }
  });

  return router;
}
