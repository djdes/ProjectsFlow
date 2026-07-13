import { Router, type NextFunction, type Request, type Response } from 'express';
import type { GetInviteByToken } from '../../application/project/GetInviteByToken.js';
import type { AcceptProjectInvite } from '../../application/project/AcceptProjectInvite.js';
import type { AcceptWorkspaceInvite } from '../../application/workspace/AcceptWorkspaceInvite.js';
import { WorkspaceInviteNotFoundError } from '../../domain/workspace/errors.js';
import { requireAuth } from '../middleware/requireAuth.js';

type Deps = {
  readonly getByToken: GetInviteByToken;
  readonly acceptWorkspace: AcceptWorkspaceInvite;
  readonly acceptProject: AcceptProjectInvite;
};

export function invitesRouter(deps: Deps): Router {
  const router = Router();

  // GET — anon-доступ. Юзер ещё может быть не залогинен (попал по ссылке).
  // Клиент решает что показать (preview + кнопка accept / редирект на логин).
  router.get('/:token', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = req.params['token'];
      if (typeof token !== 'string') {
        res.status(404).json({ error: 'invite_not_found' });
        return;
      }
      const preview = await deps.getByToken.execute(token);
      res.json({
        preview: {
          kind: preview.kind,
          targetName: preview.targetName,
          // Легаси-алиас для клиента до правки InvitePage (клиентская секция).
          projectName: preview.targetName,
          role: preview.role,
          inviterDisplayName: preview.inviterDisplayName,
          inviteEmail: preview.inviteEmail,
          expiresAt: preview.expiresAt.toISOString(),
        },
      });
    } catch (e) {
      next(e);
    }
  });

  // Accept — требует session. Токены двух поколений: сначала workspace_invites,
  // затем легаси project_invites (спека §3.1). Ответ: { workspaceId } | { projectId }.
  router.post(
    '/:token/accept',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const token = req.params['token'];
        if (typeof token !== 'string') {
          res.status(404).json({ error: 'invite_not_found' });
          return;
        }
        try {
          const { workspaceId } = await deps.acceptWorkspace.execute(token, req.user!.id);
          res.json({ workspaceId });
          return;
        } catch (err) {
          if (!(err instanceof WorkspaceInviteNotFoundError)) throw err;
          // Не workspace-токен — пробуем легаси project_invites.
        }
        const { projectId } = await deps.acceptProject.execute(token, req.user!.id);
        res.json({ projectId });
      } catch (e) {
        next(e);
      }
    },
  );

  return router;
}
