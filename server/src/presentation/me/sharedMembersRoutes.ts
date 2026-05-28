import { Router, type NextFunction, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import type { ListSharedMembers } from '../../application/project/ListSharedMembers.js';

type Deps = {
  readonly listSharedMembers: ListSharedMembers;
};

// GET /api/users/me/shared-members — список user'ов из общих проектов caller'а.
// Используется UI-дропдауном «делегировать» при создании inbox-задачи.
export function sharedMembersRouter(deps: Deps): Router {
  const r = Router();
  r.use(requireAuth);

  r.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const members = await deps.listSharedMembers.execute(req.user!.id);
      res.json({ members });
    } catch (e) {
      next(e);
    }
  });

  return r;
}
