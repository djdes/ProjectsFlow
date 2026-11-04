import { Router, type NextFunction, type Request, type Response } from 'express';
import type { GetPlatformStats } from '../../application/admin/GetPlatformStats.js';
import type { ListAllProjects } from '../../application/admin/ListAllProjects.js';
import type { ListAllUsers } from '../../application/admin/ListAllUsers.js';
import type { UpdateUserAsAdmin } from '../../application/admin/UpdateUserAsAdmin.js';
import type { DeleteUserAsAdmin, GetUserDeletionPreview } from '../../application/admin/DeleteUserAsAdmin.js';
import type { UserDeletionPlan } from '../../domain/user/userDeletion.js';
import { AdminUserError } from '../../domain/user/adminErrors.js';
import { adminBulkPlanSchema, adminPlanSchema, adminUserPatchSchema, adminUserQuerySchema } from './schemas.js';
import type { BulkSetPlanAsAdmin } from '../../application/admin/BulkSetPlanAsAdmin.js';
import type { SignOutUserEverywhere } from '../../application/admin/SignOutUserEverywhere.js';
import type { SendPasswordResetAsAdmin } from '../../application/admin/SendPasswordResetAsAdmin.js';
import type { AdminUserOverview, GetAdminUserOverview } from '../../application/admin/GetAdminUserOverview.js';
import type { AdminAuditEntry } from '../../application/admin/AdminAuditLog.js';
import type { ListUserProjectsWithDispatcher } from '../../application/admin/ListUserProjectsWithDispatcher.js';
import type { ListUserProjectsWithFavorites } from '../../application/admin/ListUserProjectsWithFavorites.js';
import type { SetUserProjectFavorite } from '../../application/admin/SetUserProjectFavorite.js';
import type { AdminProjectView, AdminUserView } from '../../application/admin/AdminRepository.js';
import type { ListAllSupportTickets } from '../../application/admin/ListAllSupportTickets.js';
import type { SetSupportTicketStatus } from '../../application/admin/SetSupportTicketStatus.js';
import type { SetUserPlanAsAdmin } from '../../application/admin/SetUserPlanAsAdmin.js';
import type { SupportTicketWithSubmitter } from '../../application/help/SupportTicketRepository.js';
import type { EmailSender } from '../../application/notifications/EmailSender.js';
import {
  EMAIL_TEMPLATES,
  renderSampleEmail,
  type EmailTemplateKey,
} from '../../application/admin/EmailTemplateCatalog.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';

type Deps = {
  // Вкладка «Статистика». Опциональна — без неё эндпоинт отвечает 404 (тесты).
  readonly getPlatformStats?: GetPlatformStats;
  readonly listAllProjects: ListAllProjects;
  readonly listAllUsers: ListAllUsers;
  readonly updateUser: UpdateUserAsAdmin;
  readonly deleteUser: DeleteUserAsAdmin;
  readonly getUserDeletionPreview: GetUserDeletionPreview;
  readonly listUserProjectsWithDispatcher: ListUserProjectsWithDispatcher;
  readonly listUserProjectsWithFavorites: ListUserProjectsWithFavorites;
  readonly setUserProjectFavorite: SetUserProjectFavorite;
  readonly listAllSupportTickets: ListAllSupportTickets;
  readonly setSupportTicketStatus: SetSupportTicketStatus;
  readonly setUserPlanAsAdmin: SetUserPlanAsAdmin;
  readonly bulkSetPlan: BulkSetPlanAsAdmin;
  readonly signOutEverywhere: SignOutUserEverywhere;
  readonly sendPasswordReset: SendPasswordResetAsAdmin;
  readonly getUserOverview: GetAdminUserOverview;
  readonly emailSender: EmailSender;
};

function projectToDto(p: AdminProjectView): Record<string, unknown> {
  return { ...p, createdAt: p.createdAt.toISOString() };
}

function userToDto(u: AdminUserView): Record<string, unknown> {
  return {
    ...u,
    createdAt: u.createdAt.toISOString(),
    subscriptionExpiresAt: u.subscriptionExpiresAt ? u.subscriptionExpiresAt.toISOString() : null,
    lastLoginAt: iso(u.lastLoginAt),
    lastActivityAt: iso(u.lastActivityAt),
    deletedAt: iso(u.deletedAt),
  };
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

function auditToDto(e: AdminAuditEntry): Record<string, unknown> {
  return { ...e, createdAt: e.createdAt.toISOString() };
}

function overviewToDto(o: AdminUserOverview): Record<string, unknown> {
  return {
    user: userToDto(o.user),
    workspaces: o.workspaces,
    projects: o.projects,
    usage: o.usage,
    activity: { ...o.activity, lastLoginAt: iso(o.activity.lastLoginAt), lastSeenAt: iso(o.activity.lastSeenAt) },
    history: o.history.map(auditToDto),
  };
}

const userIdParam = (req: Request, res: Response): string | null => {
  const id = req.params['id'];
  if (typeof id === 'string') return id;
  res.status(404).json({ error: 'not_found' });
  return null;
};

// The deletion summary for the confirm dialog. Ids stay server-side except workspace ids of blockers.
function deletionToDto(plan: UserDeletionPlan): Record<string, unknown> {
  return {
    blockers: plan.blockers,
    removedWorkspaces: plan.removeWorkspaces.map((w) => ({ name: w.name, kind: w.kind })),
    ...plan.summary,
  };
}

function ticketToDto(t: SupportTicketWithSubmitter): Record<string, unknown> {
  return { ...t, createdAt: t.createdAt.toISOString() };
}

export function adminRouter(deps: Deps): Router {
  const router = Router();
  router.use(requireAuth, requireAdmin);

  router.get('/projects', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const list = await deps.listAllProjects.execute();
      res.json({ projects: list.map(projectToDto) });
    } catch (e) {
      next(e);
    }
  });

  router.get('/stats', async (_req: Request, res: Response, next: NextFunction) => {
    if (!deps.getPlatformStats) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    try {
      res.json(await deps.getPlatformStats.execute());
    } catch (e) {
      next(e);
    }
  });

  // The users console: search, filter, sort and page; counts per filter for the chips.
  router.get('/users', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = adminUserQuerySchema.parse(req.query);
      const page = await deps.listAllUsers.execute(query);
      res.json({ users: page.items.map(userToDto), total: page.total, page: page.page, pageSize: page.pageSize, counts: page.counts });
    } catch (e) {
      next(e);
    }
  });

  // Bulk «Выдать или продлить тариф» for the selected users.
  router.post('/users/bulk/plan', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = adminBulkPlanSchema.parse(req.body);
      const term = body.term.kind === 'until' ? { kind: 'until' as const, date: new Date(body.term.date) } : body.term;
      res.json(await deps.bulkSetPlan.execute({ userIds: body.userIds, plan: body.plan, term }, req.user!.id));
    } catch (e) {
      next(e);
    }
  });

  router.get('/users/:id/overview', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = userIdParam(req, res);
      if (id === null) return;
      res.json(overviewToDto(await deps.getUserOverview.execute(id)));
    } catch (e) {
      next(e);
    }
  });

  router.post('/users/:id/sign-out-all', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = userIdParam(req, res);
      if (id === null) return;
      await deps.signOutEverywhere.execute(id, req.user!.id);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  router.post('/users/:id/password-reset', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = userIdParam(req, res);
      if (id === null) return;
      res.json(await deps.sendPasswordReset.execute(id, req.user!.id));
    } catch (e) {
      next(e);
    }
  });

  // Проекты юзера (где он owner) + текущие диспетчеры с резолвом имён.
  // Admin использует это в колонке «Проекты / Диспетчеры». Менять диспетчера
  // admin может через основной /api/projects/:id/dispatcher (admin-bypass).
  router.get(
    '/users/:id/projects-with-dispatcher',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = req.params['id'];
        if (typeof id !== 'string') {
          res.status(404).json({ error: 'not_found' });
          return;
        }
        const projects = await deps.listUserProjectsWithDispatcher.execute(id);
        res.json({ projects });
      } catch (e) {
        next(e);
      }
    },
  );

  // Проекты юзера (любые роли, кроме inbox) + его персональный favorite-флаг. Admin
  // в диалоге «Избранное» видит и переключает favorite за этого юзера.
  router.get(
    '/users/:id/projects-with-favorites',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = req.params['id'];
        if (typeof id !== 'string') {
          res.status(404).json({ error: 'not_found' });
          return;
        }
        const projects = await deps.listUserProjectsWithFavorites.execute(id);
        res.json({ projects });
      } catch (e) {
        next(e);
      }
    },
  );

  // Включить/снять favorite проекта за юзера. body: { favorite: boolean }.
  router.put(
    '/users/:id/projects/:projectId/favorite',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = req.params['id'];
        const projectId = req.params['projectId'];
        if (typeof id !== 'string' || typeof projectId !== 'string') {
          res.status(404).json({ error: 'not_found' });
          return;
        }
        const favorite = (req.body ?? {}).favorite;
        if (typeof favorite !== 'boolean') {
          res.status(400).json({ error: 'favorite must be a boolean' });
          return;
        }
        await deps.setUserProjectFavorite.execute(id, projectId, favorite);
        res.status(204).end();
      } catch (e) {
        next(e);
      }
    },
  );

  router.patch('/users/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params['id'];
      if (typeof id !== 'string') {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      const patch = adminUserPatchSchema.parse(req.body);
      await deps.updateUser.execute(id, patch, req.user!.id);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  router.get('/users/:id/deletion-preview', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params['id'];
      if (typeof id !== 'string') {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      res.json(deletionToDto(await deps.getUserDeletionPreview.execute(id, req.user!.id)));
    } catch (e) {
      next(e);
    }
  });

  router.delete('/users/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params['id'];
      if (typeof id !== 'string') {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      res.json(deletionToDto(await deps.deleteUser.execute(id, req.user!.id)));
    } catch (e) {
      next(e);
    }
  });

  // Explicit expiry supports custom dates and unlimited grants; old clients retain +30 days.
  router.patch('/users/:id/plan', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params['id'];
      if (typeof id !== 'string') {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      const { plan, subscriptionExpiresAt } = adminPlanSchema.parse(req.body);
      await deps.setUserPlanAsAdmin.execute(id, plan,
        subscriptionExpiresAt === undefined ? undefined : subscriptionExpiresAt === null ? null : new Date(subscriptionExpiresAt),
        req.user!.id);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  // --- Обращения в поддержку (рут видит в разделе «Администрирование») ---

  router.get('/support-tickets', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const list = await deps.listAllSupportTickets.execute();
      res.json({ tickets: list.map(ticketToDto) });
    } catch (e) {
      next(e);
    }
  });

  // Сменить статус обращения. body: { status: 'open' | 'closed' }.
  router.patch('/support-tickets/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params['id'];
      if (typeof id !== 'string') {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      const status = (req.body ?? {}).status;
      if (status !== 'open' && status !== 'closed') {
        res.status(400).json({ error: "status must be 'open' or 'closed'" });
        return;
      }
      await deps.setSupportTicketStatus.execute(id, status);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  // --- Email templates: каталог, предпросмотр, тестовая отправка ---

  router.get('/email/templates', (_req: Request, res: Response) => {
    res.json({ templates: EMAIL_TEMPLATES });
  });

  router.post('/email/preview', (req: Request, res: Response) => {
    const { templateKey } = req.body ?? {};
    if (typeof templateKey !== 'string') {
      res.status(400).json({ error: 'templateKey is required' });
      return;
    }
    const validKeys = EMAIL_TEMPLATES.map((t) => t.key);
    if (!validKeys.includes(templateKey as EmailTemplateKey)) {
      res.status(400).json({ error: `Unknown template: ${templateKey}` });
      return;
    }
    const msg = renderSampleEmail(templateKey as EmailTemplateKey, 'preview@example.com');
    res.json({ subject: msg.subject, html: msg.html, text: msg.text });
  });

  router.post('/email/send', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { templateKey, recipientEmail } = req.body ?? {};
      if (typeof templateKey !== 'string' || typeof recipientEmail !== 'string') {
        res.status(400).json({ error: 'templateKey and recipientEmail are required' });
        return;
      }
      const email = recipientEmail.trim();
      if (!email || !email.includes('@')) {
        res.status(400).json({ error: 'Invalid email address' });
        return;
      }
      const validKeys = EMAIL_TEMPLATES.map((t) => t.key);
      if (!validKeys.includes(templateKey as EmailTemplateKey)) {
        res.status(400).json({ error: `Unknown template: ${templateKey}` });
        return;
      }
      const msg = renderSampleEmail(templateKey as EmailTemplateKey, email);
      await deps.emailSender.send(msg);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (!(error instanceof AdminUserError)) return next(error);
    const status = error.code === 'user_not_found' ? 404
      : error.code === 'admin_access_revoked' ? 403
      : error.code === 'email_taken' || error.code === 'cannot_modify_self' || error.code === 'deletion_blocked' ? 409 : 400;
    res.status(status).json({ error: error.code, message: error.message });
  });

  return router;
}
