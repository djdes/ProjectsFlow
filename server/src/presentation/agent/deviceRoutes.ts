import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type { RequestAgentDeviceCode } from '../../application/agent/RequestAgentDeviceCode.js';
import type { ApproveAgentDeviceCode } from '../../application/agent/ApproveAgentDeviceCode.js';
import type { PollAgentDeviceToken } from '../../application/agent/PollAgentDeviceToken.js';
import type { GetAgentDeviceCodeInfo } from '../../application/agent/GetAgentDeviceCodeInfo.js';
import type { InMemoryRateLimiter } from '../../infrastructure/ratelimit/InMemoryRateLimiter.js';
import { requireAuth } from '../middleware/requireAuth.js';

type Deps = {
  readonly request: RequestAgentDeviceCode;
  readonly approve: ApproveAgentDeviceCode;
  readonly poll: PollAgentDeviceToken;
  readonly info: GetAgentDeviceCodeInfo;
  readonly rateLimiter?: InMemoryRateLimiter;
};

function clientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

// User code в формате "ABCD-1234" (8 chars + dash). Принимаем case-insensitive,
// нормализуем перед поиском в store.
const userCodeRe = /^[A-Z2-9]{4}-[A-Z2-9]{4}$/;
const userCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(userCodeRe, 'Неверный формат кода (ABCD-1234)');

const pollSchema = z.object({
  deviceCode: z.string().min(1).max(128),
});

const approveSchema = z.object({
  userCode: userCodeSchema,
  tokenName: z.string().trim().min(1, 'Введите название').max(120),
});

const userCodeQuerySchema = z.object({
  userCode: userCodeSchema,
});

// /api/agent/device — две группы:
//   • Anonymous (для MCP-клиента): /authorize, /token
//   • Session-auth (для веб-UI):    /info, /approve
//
// Решение mount'а отдельно от agentApiRouter — там Bearer-токен middleware
// блокировал бы анонимный доступ. Здесь auth декларируется per-route.
export function agentDeviceRouter(deps: Deps): Router {
  const router = Router();

  // — Anonymous endpoints —

  router.post('/authorize', (req: Request, res: Response, next: NextFunction) => {
    try {
      // Anonymous endpoint — лимитируем создание pending pairing'ов чтобы не
      // ddos'ить in-memory store и не разогревать user-code keyspace под brute-force.
      if (deps.rateLimiter) {
        if (!deps.rateLimiter.hit(`device-authorize:${clientIp(req)}`, 30, 60 * 1000)) {
          res.status(429).json({ error: 'too_many_requests' });
          return;
        }
      }
      const result = deps.request.execute();
      res.status(201).json(result);
    } catch (e) {
      next(e);
    }
  });

  router.post('/token', (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = pollSchema.parse(req.body);
      const result = deps.poll.execute({ deviceCode: body.deviceCode });
      res.json(result);
    } catch (e) {
      next(e);
    }
  });

  // — Session-auth endpoints (для веб-UI '/device' страницы) —

  router.get('/info', requireAuth, (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = userCodeQuerySchema.parse(req.query);
      const info = deps.info.execute(query.userCode);
      res.json({
        userCode: info.userCode,
        status: info.status,
        expiresAt: info.expiresAt.toISOString(),
        tokenName: info.tokenName,
      });
    } catch (e) {
      next(e);
    }
  });

  router.post('/approve', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      // ВАЖНО: user-code это 8 chars из ~28 alpha = ~38 бит. Brute-force на /approve
      // позволил бы logged-in attacker'у привязать СВОЙ agent-token к ЧУЖОМУ MCP-клиенту
      // (victim получит наш token, его команды пойдут на наш аккаунт). Лимитим жёстко.
      if (deps.rateLimiter) {
        const key = `device-approve:${req.user!.id}:${clientIp(req)}`;
        if (!deps.rateLimiter.hit(key, 5, 60 * 1000)) {
          res.status(429).json({ error: 'too_many_attempts' });
          return;
        }
      }
      const body = approveSchema.parse(req.body);
      await deps.approve.execute({
        userCode: body.userCode,
        userId: req.user!.id,
        tokenName: body.tokenName,
      });
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  return router;
}
