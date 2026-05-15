import type { Request, Response, NextFunction } from 'express';
import type { GetCurrentUser } from '../../application/auth/GetCurrentUser.js';
import { config } from '../config.js';

export function sessionFromCookie(getCurrentUser: GetCurrentUser) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const sessionId = req.cookies?.[config.session.cookieName] as string | undefined;
    if (!sessionId) return next();

    try {
      const result = await getCurrentUser.execute(sessionId);
      if (result) {
        req.user = result.user;
        req.sessionId = result.sessionId;
      }
    } catch (e) {
      // Не валим запрос — просто без user. Логируем для диагностики.
      console.error('[sessionFromCookie] error:', e);
    }
    next();
  };
}
