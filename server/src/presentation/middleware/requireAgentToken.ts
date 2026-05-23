import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AuthenticateAgentToken } from '../../application/agent/AuthenticateAgentToken.js';
import { AgentTokenInvalidError } from '../../domain/agent/errors.js';

// Middleware для agent-эндпоинтов. Авторизация через Authorization: Bearer <token>.
// При успехе кладёт req.user (как в session-auth) — дальше можно переиспользовать
// существующие use-cases с userId.
export function requireAgentToken(authenticate: AuthenticateAgentToken): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      res.status(401).json({ error: 'agent_token_required' });
      return;
    }
    const plaintext = header.slice('Bearer '.length).trim();
    if (plaintext.length === 0) {
      res.status(401).json({ error: 'agent_token_required' });
      return;
    }
    try {
      const { user, token } = await authenticate.execute(plaintext);
      req.user = user;
      req.agentTokenId = token.id;
      next();
    } catch (e) {
      if (e instanceof AgentTokenInvalidError) {
        res.status(401).json({ error: 'agent_token_invalid' });
        return;
      }
      next(e);
    }
  };
}
