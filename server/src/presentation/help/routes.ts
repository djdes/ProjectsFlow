import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type { SubmitSupportTicket } from '../../application/help/SubmitSupportTicket.js';
import { SUPPORT_MESSAGE_MAX_LENGTH } from '../../domain/help/SupportTicket.js';
import type { InMemoryRateLimiter } from '../../infrastructure/ratelimit/InMemoryRateLimiter.js';

// Анти-спам: не больше N обращений в час с одного аккаунта/IP. Анонимные (лендинг)
// особенно важно ограничить — у них нет auth-гейта.
const RATE_LIMIT_PER_HOUR = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

const contactBodySchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, 'message required')
    .max(SUPPORT_MESSAGE_MAX_LENGTH, 'message too long'),
  // 'app' (по умолчанию) — из приложения; 'landing' — анонимная отправка с лендинга.
  source: z
    .enum(['app', 'landing'])
    .optional()
    .transform((v) => v ?? 'app'),
});

type Deps = {
  readonly submit: SubmitSupportTicket;
  readonly rateLimiter: InMemoryRateLimiter;
};

export function buildHelpRouter(deps: Deps): Router {
  const r = Router();

  // POST /api/help/contact-support — обращение в поддержку. БЕЗ requireAuth: форма
  // доступна и анонимам с лендинга (тогда user_id = NULL). Если cookie валиден —
  // sessionFromCookie уже проставил req.user, привязываем тикет к нему.
  r.post('/help/contact-support', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = contactBodySchema.parse(req.body);

      const userId = req.user?.id ?? null;
      const rateKey = `support:${userId ?? req.ip ?? 'unknown'}`;
      if (!deps.rateLimiter.hit(rateKey, RATE_LIMIT_PER_HOUR, RATE_LIMIT_WINDOW_MS)) {
        res.status(429).json({ error: 'rate_limited', message: 'Слишком много обращений. Попробуйте позже.' });
        return;
      }

      await deps.submit.execute({
        userId,
        message: body.message,
        source: body.source,
      });
      res.status(201).json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  return r;
}
