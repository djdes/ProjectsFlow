import { Router, type NextFunction, type Request, type Response } from 'express';
import type {
  AssignedTaskView,
  ListTasksAssignedToMe,
} from '../../application/task/ListTasksAssignedToMe.js';
import type { ListTasksAssignedToOthers } from '../../application/task/ListTasksAssignedToOthers.js';
import type { ListPersonalTasksOfColleagues } from '../../application/task/ListPersonalTasksOfColleagues.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { toDto as taskToDto } from '../tasks/routes.js';

type Deps = {
  readonly listAssignedToMe: ListTasksAssignedToMe;
  readonly listAssignedToOthers: ListTasksAssignedToOthers;
  readonly listPersonalOfColleagues: ListPersonalTasksOfColleagues;
};

export function taskAssigneesRouter(deps: Deps): Router {
  const r = Router();
  r.use(requireAuth);

  const assignedViewToDto = (v: AssignedTaskView) => ({
    task: taskToDto({
      ...v.task,
      commitCount: v.commitCount,
      attachmentCount: v.attachmentCount,
      commentCount: v.commentCount,
    }),
    projectId: v.projectId,
    projectName: v.projectName,
    isInbox: v.isInbox,
    canModify: v.canModify,
  });

  // Все задачи, где caller — текущий ответственный.
  r.get('/mine', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const items = await deps.listAssignedToMe.execute(req.user!.id);
      res.json({ items: items.map(assignedViewToDto) });
    } catch (e) {
      next(e);
    }
  });

  // Все видимые задачи, где отвечает другой участник.
  r.get('/others', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const items = await deps.listAssignedToOthers.execute(req.user!.id);
      res.json({ items: items.map(assignedViewToDto) });
    } catch (e) {
      next(e);
    }
  });

  // Личные (inbox) задачи коллег — те, кто делит с caller'ом рабочие пространства.
  // userId берём из сессии: никаких фильтров по владельцу из query, чтобы нельзя было
  // запросить inbox произвольного пользователя.
  r.get('/personal', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const items = await deps.listPersonalOfColleagues.execute(req.user!.id);
      res.json({ items: items.map(assignedViewToDto) });
    } catch (e) {
      next(e);
    }
  });

  return r;
}
