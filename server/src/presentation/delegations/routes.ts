import { Router, type NextFunction, type Request, type Response } from 'express';
import type { AcceptTaskDelegation } from '../../application/task/AcceptTaskDelegation.js';
import type { DeclineTaskDelegation } from '../../application/task/DeclineTaskDelegation.js';
import type { WithdrawTaskDelegation } from '../../application/task/WithdrawTaskDelegation.js';
import type { ListMyPendingDelegations } from '../../application/task/ListMyPendingDelegations.js';
import type { TaskDelegation } from '../../domain/task/TaskDelegation.js';
import type { DelegationWithTaskInfo } from '../../application/task/TaskDelegationRepository.js';
import { requireAuth } from '../middleware/requireAuth.js';

type Deps = {
  readonly accept: AcceptTaskDelegation;
  readonly decline: DeclineTaskDelegation;
  readonly withdraw: WithdrawTaskDelegation;
  readonly listPending: ListMyPendingDelegations;
};

type DelegationDto = {
  id: string;
  taskId: string;
  delegateUserId: string;
  delegateDisplayName: string;
  creatorUserId: string;
  creatorDisplayName: string;
  status: string;
  createdAt: string;
  respondedAt: string | null;
};

function toDto(d: TaskDelegation): DelegationDto {
  return {
    id: d.id,
    taskId: d.taskId,
    delegateUserId: d.delegateUserId,
    delegateDisplayName: d.delegateDisplayName,
    creatorUserId: d.creatorUserId,
    creatorDisplayName: d.creatorDisplayName,
    status: d.status,
    createdAt: d.createdAt.toISOString(),
    respondedAt: d.respondedAt ? d.respondedAt.toISOString() : null,
  };
}

function pendingToDto(d: DelegationWithTaskInfo): DelegationDto & { taskExcerpt: string } {
  return { ...toDto(d), taskExcerpt: d.taskExcerpt };
}

export function delegationsRouter(deps: Deps): Router {
  const r = Router();
  r.use(requireAuth);

  // GET /api/delegations/pending — pending делегации, в которых caller — делегат.
  r.get('/pending', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const items = await deps.listPending.execute(req.user!.id);
      res.json({ delegations: items.map(pendingToDto) });
    } catch (e) {
      next(e);
    }
  });

  // POST /api/delegations/:id/accept — делегат принимает.
  r.post('/:id/accept', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const d = await deps.accept.execute(req.params['id'] as string, req.user!.id);
      res.json({ delegation: toDto(d) });
    } catch (e) {
      next(e);
    }
  });

  // POST /api/delegations/:id/decline — делегат отклоняет.
  r.post('/:id/decline', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const d = await deps.decline.execute(req.params['id'] as string, req.user!.id);
      res.json({ delegation: toDto(d) });
    } catch (e) {
      next(e);
    }
  });

  // DELETE /api/delegations/:id — создатель отзывает pending-делегацию.
  r.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      await deps.withdraw.execute(req.params['id'] as string, req.user!.id);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  return r;
}
