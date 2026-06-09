import { Router, type NextFunction, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import type { UserRepository } from '../../application/user/UserRepository.js';
import { uiPrefsSchema } from '../projects/schemas.js';

type Deps = {
  readonly users: UserRepository;
};

// Персональные UI-настройки клиента (профиль): GET текущие, PUT — частичный мерж.
// Зеркало meKanbanColorsRouter. NULL в БД → отдаём {} (клиент применит дефолты).
export function meUiPrefsRouter(deps: Deps): Router {
  const router = Router();
  router.use(requireAuth);

  // GET /me/ui-prefs — текущие настройки ({} = дефолты).
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const prefs = await deps.users.getUiPrefs(req.user!.id);
      res.json({ prefs: prefs ?? {} });
    } catch (e) {
      next(e);
    }
  });

  // PUT /me/ui-prefs — частичный мерж (setUiPrefs read-merge-write). Возвращаем итог.
  router.put('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const prefs = uiPrefsSchema.parse(req.body?.prefs ?? req.body);
      await deps.users.setUiPrefs(req.user!.id, prefs);
      const merged = await deps.users.getUiPrefs(req.user!.id);
      res.json({ prefs: merged ?? {} });
    } catch (e) {
      next(e);
    }
  });

  return router;
}
