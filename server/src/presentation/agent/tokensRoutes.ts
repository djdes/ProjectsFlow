import { Router, type NextFunction, type Request, type Response } from 'express';
import type { CreateAgentToken } from '../../application/agent/CreateAgentToken.js';
import type { ListAgentTokens } from '../../application/agent/ListAgentTokens.js';
import type { RevokeAgentToken } from '../../application/agent/RevokeAgentToken.js';
import type { AgentToken } from '../../domain/agent/AgentToken.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { createAgentTokenSchema } from './schemas.js';

type Deps = {
  readonly create: CreateAgentToken;
  readonly list: ListAgentTokens;
  readonly revoke: RevokeAgentToken;
};

type TokenDto = Omit<AgentToken, 'createdAt' | 'lastUsedAt' | 'revokedAt'> & {
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

function toDto(t: AgentToken): TokenDto {
  return {
    ...t,
    createdAt: t.createdAt.toISOString(),
    lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
    revokedAt: t.revokedAt?.toISOString() ?? null,
  };
}

// User-facing endpoints для управления своими agent-токенами. Auth через session.
export function agentTokensRouter(deps: Deps): Router {
  const router = Router();
  router.use(requireAuth);

  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = createAgentTokenSchema.parse(req.body);
      const { token, plaintext } = await deps.create.execute({
        userId: req.user!.id,
        name: body.name,
      });
      // plaintext отдаётся ОДИН раз — далее его невозможно восстановить.
      res.status(201).json({ token: toDto(token), plaintext });
    } catch (e) {
      next(e);
    }
  });

  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const list = await deps.list.execute(req.user!.id);
      res.json({ tokens: list.map(toDto) });
    } catch (e) {
      next(e);
    }
  });

  router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params['id'] as string;
      await deps.revoke.execute(req.user!.id, id);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  return router;
}
