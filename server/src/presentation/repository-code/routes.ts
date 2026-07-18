import { Router } from 'express';
import { z } from 'zod';
import type { ManageProjectRepositoryCode } from '../../application/github/ManageProjectRepositoryCode.js';
import { requireAuth } from '../middleware/requireAuth.js';

type Deps = { readonly repositoryCode: ManageProjectRepositoryCode };

const saveFileSchema = z.object({
  path: z.string().min(1).max(1_000),
  sha: z.string().min(1).max(200),
  content: z.string().max(210_000),
  message: z.string().max(240).optional(),
}).strict();

export function repositoryCodeRouter(deps: Deps): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/:projectId/repository/tree', async (req, res, next) => {
    try {
      const tree = await deps.repositoryCode.getTree(req.params.projectId as string, req.user!.id);
      res.setHeader('Cache-Control', 'no-store');
      res.json(tree);
    } catch (error) { next(error); }
  });

  router.get('/:projectId/repository/file', async (req, res, next) => {
    try {
      const path = z.string().min(1).max(1_000).parse(req.query.path);
      const file = await deps.repositoryCode.getFile(req.params.projectId as string, req.user!.id, path);
      res.setHeader('Cache-Control', 'no-store');
      res.json(file);
    } catch (error) { next(error); }
  });

  router.put('/:projectId/repository/file', async (req, res, next) => {
    try {
      const input = saveFileSchema.parse(req.body);
      const result = await deps.repositoryCode.saveFile(req.params.projectId as string, req.user!.id, input);
      res.json(result);
    } catch (error) { next(error); }
  });

  return router;
}
