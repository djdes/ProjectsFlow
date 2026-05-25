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
      // Не валим запрос — просто без user. Логируем только message: dumping
      // full error мог бы leak'нуть SQL-сообщения / схему через server logs,
      // если attacker подкидывает malformed cookie специально чтобы поймать
      // mysql2 error в логе.
      console.error('[sessionFromCookie]', (e as Error).message);
    }
    next();
  };
}
