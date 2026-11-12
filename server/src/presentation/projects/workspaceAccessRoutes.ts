import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import type { ManageProjectSharing } from '../../application/project/ManageProjectSharing.js';

// «Доступ пространств» проекта (db/182): подключённые пространства и кто чьи задачи видит.
const workspaceScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }),
  z.object({ kind: z.literal('own') }),
  z.object({ kind: z.literal('selected'), from: z.array(z.string().trim().min(1).max(36)).max(50) }),
]);

const memberScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }),
  z.object({ kind: z.literal('mine') }),
  z.object({ kind: z.literal('selected'), from: z.array(z.string().trim().min(1).max(36)).max(50) }),
]);

const saveSchema = z.object({
  workspaces: z.array(z.object({ workspaceId: z.string().trim().min(1).max(36), taskScope: workspaceScopeSchema })).max(50),
  members: z.array(z.object({ userId: z.string().trim().min(1).max(36), taskScope: memberScopeSchema })).max(500),
});

export function projectWorkspaceAccessRouter(deps: { readonly manage: ManageProjectSharing }): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/:id/workspace-access', async (req, res, next) => {
    try {
      res.json(await deps.manage.get(req.params.id, req.user!.id));
    } catch (error) {
      next(error);
    }
  });

  router.put('/:id/workspace-access', async (req, res, next) => {
    try {
      const body = saveSchema.parse(req.body);
      res.json(await deps.manage.save(req.params.id, req.user!.id, body));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
