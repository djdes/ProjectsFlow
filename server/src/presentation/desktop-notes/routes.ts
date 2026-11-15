import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type { AuthenticateAgentToken } from '../../application/agent/AuthenticateAgentToken.js';
import {
  DesktopNotePinLimitError,
  type DesktopNote,
  type DesktopNotesService,
} from '../../application/desktop-notes/DesktopNotesService.js';
import { requireAgentToken } from '../middleware/requireAgentToken.js';
import { requireAuth } from '../middleware/requireAuth.js';

type Deps = {
  readonly service: DesktopNotesService;
  readonly authenticate: AuthenticateAgentToken;
};

const taskIdSchema = z.string().uuid();
const versionSchema = z.string().trim().max(32).regex(/^[0-9A-Za-z.+-]*$/u);

const dto = (n: DesktopNote) => ({ ...n });

// /api/desktop-notes — общий для интерфейса (cookie) и приложения «ProjectsFlow Заметки»
// (Bearer-токен аккаунта, выданный через /device). Приложение опрашивает GET раз в несколько
// секунд; этот же запрос отмечает, что оно на связи.
export function desktopNotesRouter(deps: Deps): Router {
  const router = Router();

  router.use((req, res, next) => {
    if (!req.headers.authorization) {
      next();
      return;
    }
    requireAgentToken(deps.authenticate)(req, res, (error?: unknown) => {
      if (error) {
        next(error);
        return;
      }
      if (req.agentToken?.scopeKind !== 'account') {
        res.status(403).json({ error: 'account_token_required' });
        return;
      }
      next();
    });
  });
  router.use(requireAuth);

  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      if (req.agentToken) {
        const header = req.headers['x-pf-notes-version'];
        const version = versionSchema.safeParse(typeof header === 'string' ? header : '');
        await deps.service.heartbeat(userId, version.success && version.data ? version.data : null);
      }
      const view = await deps.service.list(userId);
      res.set('Cache-Control', 'private, no-store').json({
        notes: view.notes.map(dto),
        appLastSeenAt: view.appLastSeenAt?.toISOString() ?? null,
      });
    } catch (e) {
      next(e);
    }
  });

  router.put('/:taskId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const note = await deps.service.pin(req.user!.id, taskIdSchema.parse(req.params['taskId']));
      res.json({ note: dto(note) });
    } catch (e) {
      if (e instanceof DesktopNotePinLimitError) {
        res.status(409).json({ error: 'pin_limit', message: e.message });
        return;
      }
      next(e);
    }
  });

  router.delete('/:taskId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      await deps.service.unpin(req.user!.id, taskIdSchema.parse(req.params['taskId']));
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  return router;
}
