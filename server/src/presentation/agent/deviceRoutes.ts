import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type { RequestAgentDeviceCode } from '../../application/agent/RequestAgentDeviceCode.js';
import type { ApproveAgentDeviceCode } from '../../application/agent/ApproveAgentDeviceCode.js';
import type { PollAgentDeviceToken } from '../../application/agent/PollAgentDeviceToken.js';
import type { GetAgentDeviceCodeInfo } from '../../application/agent/GetAgentDeviceCodeInfo.js';
import { requireAuth } from '../middleware/requireAuth.js';

type Deps = {
  readonly request: RequestAgentDeviceCode;
  readonly approve: ApproveAgentDeviceCode;
  readonly poll: PollAgentDeviceToken;
  readonly info: GetAgentDeviceCodeInfo;
};

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

  router.post('/authorize', (_req: Request, res: Response, next: NextFunction) => {
    try {
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
