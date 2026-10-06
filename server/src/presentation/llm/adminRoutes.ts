import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { PLATFORM_OWNER, type LlmConnection } from '../../domain/llm/LlmConnection.js';
import type { LlmDeviceLogin } from '../../domain/llm/LlmDeviceLogin.js';
import type { LlmSettings } from '../../domain/llm/LlmSettings.js';
import type { LlmConnectionService } from '../../application/llm/LlmConnectionService.js';
import type { LlmSettingsService } from '../../application/llm/LlmSettingsService.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';

type Deps = {
  readonly connections: LlmConnectionService;
  readonly settings: LlmSettingsService;
};

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

// Токены наружу не отдаются никогда — только сведения о подключении.
export function llmConnectionToDto(c: LlmConnection | null): Record<string, unknown> | null {
  if (!c) return null;
  return {
    id: c.id,
    provider: c.provider,
    status: c.status,
    accountEmail: c.accountEmail,
    planType: c.planType,
    accessExpiresAt: iso(c.accessExpiresAt),
    lastRefreshAt: iso(c.lastRefreshAt),
    rateLimitedUntil: iso(c.rateLimitedUntil),
    lastError: c.lastError,
    lastUsedAt: iso(c.lastUsedAt),
    createdAt: c.createdAt.toISOString(),
  };
}

function loginToDto(l: LlmDeviceLogin | null): Record<string, unknown> | null {
  if (!l) return null;
  return {
    userCode: l.userCode,
    verificationUrl: l.verificationUrl,
    intervalSec: l.intervalSec,
    expiresAt: l.expiresAt.toISOString(),
  };
}

function settingsToDto(s: LlmSettings): Record<string, unknown> {
  return {
    defaultModel: s.defaultModel,
    fastModel: s.fastModel,
    serverQueues: s.serverQueues,
    updatedAt: iso(s.updatedAt),
  };
}

const settingsSchema = z.object({
  defaultModel: z.string().max(64).nullable().optional(),
  fastModel: z.string().max(64).nullable().optional(),
  serverQueues: z.array(z.string().max(32)).max(10).optional(),
});

// Подключение платформенной подписки ChatGPT по коду (/api/admin/llm). Только для админов.
export function llmAdminRouter(deps: Deps): Router {
  const router = Router();
  router.use(requireAuth, requireAdmin);
  const owner = PLATFORM_OWNER;

  router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const status = await deps.connections.getStatus(owner);
      res.json({
        connection: llmConnectionToDto(status.connection),
        pendingLogin: loginToDto(status.pendingLogin),
        settings: settingsToDto(status.settings),
      });
    } catch (e) {
      next(e);
    }
  });

  router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const login = await deps.connections.startLogin({ owner, actorUserId: req.user!.id });
      res.json({ pendingLogin: loginToDto(login) });
    } catch (e) {
      next(e);
    }
  });

  router.post('/login/poll', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await deps.connections.pollLogin(owner);
      if (result.status === 'pending') {
        res.json({ status: 'pending', pendingLogin: loginToDto(result.login) });
        return;
      }
      if (result.status === 'connected') {
        res.json({ status: 'connected', connection: llmConnectionToDto(result.connection) });
        return;
      }
      res.json({ status: result.status });
    } catch (e) {
      next(e);
    }
  });

  router.delete('/login', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      await deps.connections.cancelLogin(owner);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  router.delete('/', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      await deps.connections.disconnect(owner);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  router.put('/settings', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = settingsSchema.parse(req.body ?? {});
      const settings = await deps.settings.update({ actorUserId: req.user!.id, ...body });
      res.json({ settings: settingsToDto(settings) });
    } catch (e) {
      next(e);
    }
  });

  router.post('/test', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await deps.connections.test(owner));
    } catch (e) {
      next(e);
    }
  });

  return router;
}
