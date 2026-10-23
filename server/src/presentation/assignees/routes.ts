import { Router, type NextFunction, type Request, type Response } from 'express';
import type {
  AssignedTaskView,
  ListTasksAssignedToMe,
} from '../../application/task/ListTasksAssignedToMe.js';
import type { ListTasksAssignedToOthers } from '../../application/task/ListTasksAssignedToOthers.js';
import type { ListPersonalTasksOfColleagues } from '../../application/task/ListPersonalTasksOfColleagues.js';
import type { ListMemberTasksForLead } from '../../application/task/ListMemberTasksForLead.js';
import type { ListApprovalQueue } from '../../application/task/ListApprovalQueue.js';
import type { ListTasksAwaitingMyReply } from '../../application/task/ListTasksAwaitingMyReply.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { toDto as taskToDto } from '../tasks/routes.js';

type Deps = {
  readonly listAssignedToMe: ListTasksAssignedToMe;
  readonly listAssignedToOthers: ListTasksAssignedToOthers;
  readonly listPersonalOfColleagues: ListPersonalTasksOfColleagues;
  readonly listMemberTasksForLead: ListMemberTasksForLead;
  readonly listApprovalQueue: ListApprovalQueue;
  readonly listAwaitingMyReply: ListTasksAwaitingMyReply;
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
    inboxOwner: v.inboxOwner,
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

  // Доска сотрудника для руководителя пространства (BUG D): ВСЕ его незавершённые задачи
  // по всем проектам активного пространства, включая проекты, где сам вызывающий не
  // участник. Гейт (lead/owner + memberId — участник того же пространства) — целиком
  // внутри use-case; здесь только 403/404 из его ошибок через errorHandler.
  r.get('/member/:userId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const items = await deps.listMemberTasksForLead.execute(req.user!.id, req.params.userId as string);
      res.json({ items: items.map(assignedViewToDto) });
    } catch (e) {
      next(e);
    }
  });

  // Очередь приёмки руководителя: все задачи «На утверждении» активного пространства, которые
  // он вправе принять (в том числе поставленные не им). Не руководителю — пустой список.
  r.get('/approvals', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const items = await deps.listApprovalQueue.execute(req.user!.id);
      res.json({ items: items.map(assignedViewToDto) });
    } catch (e) {
      next(e);
    }
  });

  // Задачи, где caller'у адресовали комментарий («Кого уведомить» или @), а он ещё не
  // ответил — подсветка карточек и фильтр «Ответить» во «Входящих».
  r.get('/awaiting-reply', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const items = await deps.listAwaitingMyReply.execute(req.user!.id);
      res.json({
        items: items.map((v) => ({
          ...assignedViewToDto(v),
          question: { ...v.question, askedAt: v.question.askedAt.toISOString() },
        })),
      });
    } catch (e) {
      next(e);
    }
  });

  return r;
}
