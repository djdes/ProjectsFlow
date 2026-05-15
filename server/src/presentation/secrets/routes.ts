import { Router, type NextFunction, type Request, type Response } from 'express';
import type { PutSecret } from '../../application/secrets/PutSecret.js';
import type { GetSecret } from '../../application/secrets/GetSecret.js';
import type { DeleteSecret } from '../../application/secrets/DeleteSecret.js';
import type { ListSecretKeys } from '../../application/secrets/ListSecretKeys.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { putSecretSchema, secretKeyQuerySchema } from './schemas.js';

type Deps = {
  readonly putSecret: PutSecret;
  readonly getSecret: GetSecret;
  readonly deleteSecret: DeleteSecret;
  readonly listSecretKeys: ListSecretKeys;
};

export function secretsRouter(deps: Deps): Router {
  const router = Router();
  router.use(requireAuth);

  router.put('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = putSecretSchema.parse(req.body);
      await deps.putSecret.execute(req.user!.id, body.key, body.value);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { key } = secretKeyQuerySchema.parse(req.query);
      const value = await deps.getSecret.execute(req.user!.id, key);
      res.json({ value });
    } catch (e) {
      next(e);
    }
  });

  router.delete('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { key } = secretKeyQuerySchema.parse(req.query);
      const deleted = await deps.deleteSecret.execute(req.user!.id, key);
      res.status(deleted ? 204 : 404).end();
    } catch (e) {
      next(e);
    }
  });

  router.get('/list', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const list = await deps.listSecretKeys.execute(req.user!.id);
      res.json({
        secrets: list.map((s) => ({
          key: s.secretKey,
          createdAt: s.createdAt.toISOString(),
          updatedAt: s.updatedAt.toISOString(),
        })),
      });
    } catch (e) {
      next(e);
    }
  });

  return router;
}
