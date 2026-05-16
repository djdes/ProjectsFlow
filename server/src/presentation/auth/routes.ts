import { Router, type CookieOptions, type Request, type Response, type NextFunction } from 'express';
import type { RequestMagicLink } from '../../application/auth/RequestMagicLink.js';
import type { ConsumeMagicLink } from '../../application/auth/ConsumeMagicLink.js';
import type { Logout } from '../../application/auth/Logout.js';
import type { UpdateProfile } from '../../application/user/UpdateProfile.js';
import type { User } from '../../domain/user/User.js';
import type { Session } from '../../domain/session/Session.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { config, isProd, sessionTtlMs } from '../config.js';
import { consumeMagicLinkSchema, requestMagicLinkSchema, updateProfileSchema } from './schemas.js';

type Deps = {
  readonly requestMagicLink: RequestMagicLink;
  readonly consumeMagicLink: ConsumeMagicLink;
  readonly logout: Logout;
  readonly updateProfile: UpdateProfile;
};

function sessionCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd(),
    maxAge: sessionTtlMs(),
    path: '/',
    domain: config.session.cookieDomain,
  };
}

function setSessionCookie(res: Response, session: Session): void {
  res.cookie(config.session.cookieName, session.id, sessionCookieOptions());
}

function clearSessionCookie(res: Response): void {
  res.clearCookie(config.session.cookieName, {
    path: '/',
    domain: config.session.cookieDomain,
  });
}

function publicUser(user: User): Omit<User, 'createdAt'> & { createdAt: string } {
  return { ...user, createdAt: user.createdAt.toISOString() };
}

export function authRouter(deps: Deps): Router {
  const router = Router();

  router.post('/magic/request', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = requestMagicLinkSchema.parse(req.body);
      const { url } = await deps.requestMagicLink.execute(body);
      // В dev отдаём URL прямо в ответе — удобно тестировать без SMTP.
      // В prod возвращаем только { ok: true }, чтобы не раскрывать факт существования email.
      res.json(isProd() ? { ok: true } : { ok: true, devMagicUrl: url });
    } catch (e) {
      next(e);
    }
  });

  router.post('/magic/consume', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = consumeMagicLinkSchema.parse(req.body);
      const { user, session } = await deps.consumeMagicLink.execute(body);
      setSessionCookie(res, session);
      res.json({ user: publicUser(user) });
    } catch (e) {
      next(e);
    }
  });

  router.post('/logout', async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (req.sessionId) {
        await deps.logout.execute(req.sessionId);
      }
      clearSessionCookie(res);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  router.get('/me', requireAuth, (req: Request, res: Response) => {
    res.json({ user: publicUser(req.user!) });
  });

  router.patch('/me', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = updateProfileSchema.parse(req.body);
      const updated = await deps.updateProfile.execute(req.user!.id, body);
      res.json({ user: publicUser(updated) });
    } catch (e) {
      next(e);
    }
  });

  return router;
}
