import { Router, type NextFunction, type Request, type Response } from 'express';
import type { GetOrCreateInbox } from '../../application/project/GetOrCreateInbox.js';
import type { Project } from '../../domain/project/Project.js';
import { requireAuth } from '../middleware/requireAuth.js';

type Deps = {
  readonly getOrCreateInbox: GetOrCreateInbox;
};

type ProjectDto = Omit<Project, 'createdAt'> & { createdAt: string };

function toDto(p: Project): ProjectDto {
  return { ...p, createdAt: p.createdAt.toISOString() };
}

// GET /api/inbox — отдаёт inbox-проект юзера. Создаёт лениво если ещё нет.
// Клиент использует id из ответа чтобы стучаться в обычные task-эндпоинты
// (/api/projects/<inbox.id>/tasks/...).
export function inboxRouter(deps: Deps): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const project = await deps.getOrCreateInbox.execute(req.user!.id);
      res.json({ project: toDto(project) });
    } catch (e) {
      next(e);
    }
  });

  return router;
}
