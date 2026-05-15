import { Router, type CookieOptions, type Request, type Response, type NextFunction } from 'express';
import type { Register } from '../../application/auth/Register.js';
import type { Login } from '../../application/auth/Login.js';
import type { Logout } from '../../application/auth/Logout.js';
import type { UpdateProfile } from '../../application/user/UpdateProfile.js';
import type { User } from '../../domain/user/User.js';
import type { Session } from '../../domain/session/Session.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { config, isProd, sessionTtlMs } from '../config.js';
import { loginSchema, registerSchema, updateProfileSchema } from './schemas.js';

type Deps = {
  readonly register: Register;
  readonly login: Login;
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
  };
}

function setSessionCookie(res: Response, session: Session): void {
  res.cookie(config.session.cookieName, session.id, sessionCookieOptions());
}

function clearSessionCookie(res: Response): void {
  res.clearCookie(config.session.cookieName, { path: '/' });
}

function publicUser(user: User): Omit<User, 'createdAt'> & { createdAt: string } {
  return { ...user, createdAt: user.createdAt.toISOString() };
}

export function authRouter(deps: Deps): Router {
  const router = Router();

  router.post('/register', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = registerSchema.parse(req.body);
      const { user, session } = await deps.register.execute(body);
      setSessionCookie(res, session);
      res.status(201).json({ user: publicUser(user) });
    } catch (e) {
      next(e);
    }
  });

  router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = loginSchema.parse(req.body);
      const { user, session } = await deps.login.execute(body);
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
