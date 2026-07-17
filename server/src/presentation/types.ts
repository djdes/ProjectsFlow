import type { User } from '../domain/user/User.js';
import type { AgentToken } from '../domain/agent/AgentToken.js';

// Глобальное расширение Express.Request: middleware sessionFromCookie
// прикладывает user/sessionId, чтобы остальной код типобезопасно их читал.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
      sessionId?: string;
      // ID agent-токена, которым выполнен запрос (только для /api/agent/* через
      // requireAgentToken). Нужен, чтобы пометить `isCurrent` в pf_get_my_account.
      agentTokenId?: string;
      agentToken?: AgentToken;
    }
  }
}

export {};
