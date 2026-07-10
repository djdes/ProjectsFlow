import { Router, type NextFunction, type Request, type Response } from 'express';
import type { AcceptTaskDelegation } from '../../application/task/AcceptTaskDelegation.js';
import type { DeclineTaskDelegation } from '../../application/task/DeclineTaskDelegation.js';
import type { WithdrawTaskDelegation } from '../../application/task/WithdrawTaskDelegation.js';
import type { ListMyPendingDelegations } from '../../application/task/ListMyPendingDelegations.js';
import type {
  AssignedTaskView,
  ListTasksAssignedToMe,
} from '../../application/task/ListTasksAssignedToMe.js';
import type { ListTasksDelegatedToOthers } from '../../application/task/ListTasksDelegatedToOthers.js';
import type { TaskDelegation } from '../../domain/task/TaskDelegation.js';
import type { DelegationWithTaskInfo } from '../../application/task/TaskDelegationRepository.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { toDto as taskToDto } from '../tasks/routes.js';

type Deps = {
  readonly accept: AcceptTaskDelegation;
  readonly decline: DeclineTaskDelegation;
  readonly withdraw: WithdrawTaskDelegation;
  readonly listPending: ListMyPendingDelegations;
  readonly listAssignedToMe: ListTasksAssignedToMe;
  readonly listDelegatedToOthers: ListTasksDelegatedToOthers;
};

type DelegationDto = {
  id: string;
  taskId: string;
  delegateUserId: string;
  delegateDisplayName: string;
  delegateAvatarUrl: string | null;
  creatorUserId: string;
  creatorDisplayName: string;
  creatorAvatarUrl: string | null;
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
    delegateAvatarUrl: d.delegateAvatarUrl ?? null,
    creatorUserId: d.creatorUserId,
    creatorDisplayName: d.creatorDisplayName,
    creatorAvatarUrl: d.creatorAvatarUrl ?? null,
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

  // GET /api/delegations/assigned-to-me — все активные (pending|accepted) делегации НА
  // caller'а по всем проектам, для вкладки «Для меня». Группировку делает клиент.
  r.get('/assigned-to-me', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const items = await deps.listAssignedToMe.execute(req.user!.id);
      res.json({ items: items.map(assignedViewToDto) });
    } catch (e) {
      next(e);
    }
  });

  // GET /api/delegations/delegated-to-others — все активные (pending|accepted) делегации
  // «кому-то другому», видимые caller'у: в именованных проектах-участниках — от любого
  // любому; inbox — только собственные исходящие. Вкладка «Другим»; фильтры (от кого/
  // кому/проект) делает клиент.
  r.get('/delegated-to-others', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const items = await deps.listDelegatedToOthers.execute(req.user!.id);
      res.json({ items: items.map(assignedViewToDto) });
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
