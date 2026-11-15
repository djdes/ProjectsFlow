import type { NextFunction, Request, Response, RequestHandler } from 'express';
import type { AuthenticateAgentToken } from '../../application/agent/AuthenticateAgentToken.js';
import { requireAgentToken } from '../middleware/requireAgentToken.js';

// Приложение «ProjectsFlow Заметки» входит токеном аккаунта (Bearer), а не cookie. Чтобы
// развёрнутая заметка писала комментарии и открывала файлы ровно так же, как интерфейс
// (те же проверки доступа, уведомления, авто-возврат из уточнения), на этих немногих
// маршрутах задач токен аккаунта принимается вместо сессии. Всё остальное — только cookie.
const ALLOWED: ReadonlyArray<{ readonly method: string; readonly path: RegExp }> = [
  { method: 'POST', path: /^\/api\/projects\/[^/]+\/tasks\/[^/]+\/comments$/u },
  { method: 'GET', path: /^\/api\/projects\/[^/]+\/tasks\/[^/]+\/comment-notify-candidates$/u },
  { method: 'GET', path: /^\/api\/attachments\/[^/]+$/u },
];

export function accountTokenOnTaskPaths(authenticate: AuthenticateAgentToken): RequestHandler {
  const check = requireAgentToken(authenticate);
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.user || !req.headers.authorization?.startsWith('Bearer ')) {
      next();
      return;
    }
    if (!ALLOWED.some((a) => a.method === req.method && a.path.test(req.path))) {
      next();
      return;
    }
    void check(req, res, (error?: unknown) => {
      if (error) {
        next(error);
        return;
      }
      if (req.agentToken?.scopeKind !== 'account') {
        req.user = undefined;
        res.status(403).json({ error: 'account_token_required' });
        return;
      }
      next();
    });
  };
}
