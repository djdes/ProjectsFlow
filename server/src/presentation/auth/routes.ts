import { Router, type CookieOptions, type Request, type Response, type NextFunction } from 'express';
import type { Register } from '../../application/auth/Register.js';
import type { Login } from '../../application/auth/Login.js';
import type { Logout } from '../../application/auth/Logout.js';
import type { UpdateProfile } from '../../application/user/UpdateProfile.js';
import type { User } from '../../domain/user/User.js';
import type { Session } from '../../domain/session/Session.js';
import type { InMemoryRateLimiter } from '../../infrastructure/ratelimit/InMemoryRateLimiter.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { config, isProd, sessionTtlMs } from '../config.js';
import { loginSchema, registerSchema, updateProfileSchema } from './schemas.js';

type Deps = {
  readonly register: Register;
  readonly login: Login;
  readonly logout: Logout;
  readonly updateProfile: UpdateProfile;
  // Опционально: rate-limiter для anti-brute-force на /login и /register.
  // Если не передан — лимита нет (для тестов).
  readonly rateLimiter?: InMemoryRateLimiter;
};

// IP клиента из X-Forwarded-For (nginx-proxy перед нами) или прямого соединения.
function clientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

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
      // Anti-brute-force: 10 попыток на (IP, email) за 10 минут. Argon2 на caller-side
      // даёт ~50-200ms/попытку, но это не защищает от distributed brute-force.
      // Лимитим ДО login.execute, чтобы не тратить CPU на Argon2 в любом случае.
      if (deps.rateLimiter) {
        const key = `login:${clientIp(req)}:${body.email.toLowerCase()}`;
        if (!deps.rateLimiter.hit(key, 10, 10 * 60 * 1000)) {
          res.status(429).json({ error: 'too_many_login_attempts' });
          return;
        }
      }
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
