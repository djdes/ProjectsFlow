import { Router, type NextFunction, type Request, type Response } from 'express';
import type { ListAllProjects } from '../../application/admin/ListAllProjects.js';
import type { ListAllUsers } from '../../application/admin/ListAllUsers.js';
import type { UpdateUserAsAdmin } from '../../application/admin/UpdateUserAsAdmin.js';
import type { ListUserProjectsWithDispatcher } from '../../application/admin/ListUserProjectsWithDispatcher.js';
import type { AdminProjectView, AdminUserView } from '../../application/admin/AdminRepository.js';
import type { EmailSender } from '../../application/notifications/EmailSender.js';
import {
  EMAIL_TEMPLATES,
  renderSampleEmail,
  type EmailTemplateKey,
} from '../../application/admin/EmailTemplateCatalog.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';

type Deps = {
  readonly listAllProjects: ListAllProjects;
  readonly listAllUsers: ListAllUsers;
  readonly updateUser: UpdateUserAsAdmin;
  readonly listUserProjectsWithDispatcher: ListUserProjectsWithDispatcher;
  readonly emailSender: EmailSender;
};

function projectToDto(p: AdminProjectView): Record<string, unknown> {
  return { ...p, createdAt: p.createdAt.toISOString() };
}

function userToDto(u: AdminUserView): Record<string, unknown> {
  return { ...u, createdAt: u.createdAt.toISOString() };
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

  router.get('/users', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const list = await deps.listAllUsers.execute();
      res.json({ users: list.map(userToDto) });
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

  router.patch('/users/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params['id'];
      if (typeof id !== 'string') {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      const body = req.body ?? {};
      const patch: { displayName?: string; email?: string; isAdmin?: boolean } = {};
      if (typeof body.displayName === 'string') patch.displayName = body.displayName;
      if (typeof body.email === 'string') patch.email = body.email;
      if (typeof body.isAdmin === 'boolean') patch.isAdmin = body.isAdmin;
      await deps.updateUser.execute(id, patch);
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

  return router;
}
