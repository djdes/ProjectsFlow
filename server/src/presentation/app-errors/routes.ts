import express, { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { APP_ERROR_LEVELS, type AppErrorReports } from '../../application/app-errors/AppErrorReports.js';
import { requireAgentToken } from '../middleware/requireAgentToken.js';
import type { AuthenticateAgentToken } from '../../application/agent/AuthenticateAgentToken.js';

const ingestSchema = z.object({
  reportId: z.string().trim().min(8).max(64),
  program: z.string().trim().min(1).max(100),
  version: z.string().max(100).nullish(),
  machine: z.string().max(100).nullish(),
  user: z.string().max(100).nullish(),
  level: z.enum(APP_ERROR_LEVELS as [string, ...string[]]).default('error'),
  caption: z.string().trim().min(1).transform((s) => s.slice(0, 1000)),
  details: z.string().max(64 * 1024).nullish(),
  log: z.string().nullish(),
  occurredAt: z.coerce.date().optional(),
});

// Приём отчётов от десктопных программ (error-kit). Свой парсер с лимитом 1 МБ:
// отчёт несёт хвост лога, общий express.json ограничен 256 КБ.
export function appErrorIngestRouter(service: AppErrorReports): Router {
  const r = Router();
  r.post('/', express.json({ limit: '1mb' }), async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!service.checkKey(req.get('x-app-error-key'))) { res.status(401).json({ error: 'invalid_key' }); return; }
      const parsed = ingestSchema.safeParse(req.body);
      if (!parsed.success) { res.status(400).json({ error: 'invalid_body' }); return; }
      const b = parsed.data;
      await service.ingest({ ...b, level: b.level as never });
      res.status(202).json({ ok: true });
    } catch (e) { next(e); }
  });
  return r;
}

// Поиск отчётов для воркера: только аккаунт администратора (отчёты всех программ и машин).
export function appErrorAgentRouter(service: AppErrorReports, authenticate: AuthenticateAgentToken): Router {
  const r = Router();
  r.use(requireAgentToken(authenticate));
  r.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (req.user?.isAdmin !== true) { res.status(403).json({ error: 'admin_required' }); return; }
      const q = z.object({
        program: z.string().trim().max(100).optional(),
        query: z.string().trim().max(200).optional(),
        hours: z.coerce.number().int().min(1).max(2160).default(72),
        limit: z.coerce.number().int().min(1).max(100).default(20),
        withLog: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
      }).safeParse(req.query);
      if (!q.success) { res.status(400).json({ error: 'invalid_query' }); return; }
      const items = await service.search(q.data);
      res.set('Cache-Control', 'private, no-store').json({ items: items.map((i) => ({
        id: i.id, program: i.program, version: i.version, machine: i.machine, user: i.userName, level: i.level,
        caption: i.caption, details: i.details, ...(q.data.withLog ? { log: i.logTail } : {}),
        occurredAt: new Date(i.occurredAt).toISOString(), receivedAt: new Date(i.receivedAt).toISOString(),
      })) });
    } catch (e) { next(e); }
  });
  return r;
}
