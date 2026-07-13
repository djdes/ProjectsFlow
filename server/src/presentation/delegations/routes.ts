import { Router, type NextFunction, type Request, type Response } from 'express';
import type { WithdrawTaskDelegation } from '../../application/task/WithdrawTaskDelegation.js';
import type { RelinquishTaskDelegation } from '../../application/task/RelinquishTaskDelegation.js';
import type {
  AssignedTaskView,
  ListTasksAssignedToMe,
} from '../../application/task/ListTasksAssignedToMe.js';
import type { ListTasksDelegatedToOthers } from '../../application/task/ListTasksDelegatedToOthers.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { toDto as taskToDto } from '../tasks/routes.js';

// Делегирование мгновенное (accepted при создании, спека §4): accept/decline/pending
// эндпоинтов больше нет. Остались списки и два «отката»: withdraw (создатель забирает)
// и relinquish (делегат снимает с себя).
type Deps = {
  readonly withdraw: WithdrawTaskDelegation;
  readonly relinquish: RelinquishTaskDelegation;
  readonly listAssignedToMe: ListTasksAssignedToMe;
  readonly listDelegatedToOthers: ListTasksDelegatedToOthers;
};

export function delegationsRouter(deps: Deps): Router {
  const r = Router();
  r.use(requireAuth);

  // Общий DTO-маппинг строк assigned-to-me / delegated-by-me (одинаковый view-shape):
  // counts вмерживаем в task (toDto подхватит их как у TaskWithCounts) — клиент рисует
  // строку теми же карточками.
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

  // GET /api/delegations/assigned-to-me — все активные делегации НА caller'а по всем
  // проектам, для вкладки «Для меня». Группировку делает клиент.
  r.get('/assigned-to-me', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const items = await deps.listAssignedToMe.execute(req.user!.id);
      res.json({ items: items.map(assignedViewToDto) });
    } catch (e) {
      next(e);
    }
  });

  // GET /api/delegations/delegated-to-others — все активные делегации «кому-то другому»,
  // видимые caller'у: в именованных проектах-участниках — от любого любому; inbox —
  // только собственные исходящие. Вкладка «Другим»; фильтры делает клиент.
  r.get('/delegated-to-others', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const items = await deps.listDelegatedToOthers.execute(req.user!.id);
      res.json({ items: items.map(assignedViewToDto) });
    } catch (e) {
      next(e);
    }
  });

  // DELETE /api/delegations/:id — создатель отзывает делегацию (забирает задачу назад).
  r.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      await deps.withdraw.execute(req.params['id'] as string, req.user!.id);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  // POST /api/delegations/:id/relinquish — ДЕЛЕГАТ складывает с себя активную делегацию
  // (drag карточки из блока делегирования на нижнюю доску «Входящих»).
  r.post('/:id/relinquish', async (req: Request, res: Response, next: NextFunction) => {
    try {
      await deps.relinquish.execute(req.params['id'] as string, req.user!.id);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  return r;
}
