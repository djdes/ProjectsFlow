import type { User } from '../domain/user/User.js';

// Глобальное расширение Express.Request: middleware sessionFromCookie
// прикладывает user/sessionId, чтобы остальной код типобезопасно их читал.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
      sessionId?: string;
    }
  }
}

export {};
