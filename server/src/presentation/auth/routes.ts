import { Router, type CookieOptions, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import type { Register } from '../../application/auth/Register.js';
import type { Login } from '../../application/auth/Login.js';
import type { Logout } from '../../application/auth/Logout.js';
import type { UpdateProfile } from '../../application/user/UpdateProfile.js';
import type { UploadUserAvatar } from '../../application/user/UploadUserAvatar.js';
import type { User } from '../../domain/user/User.js';
import type { Session } from '../../domain/session/Session.js';
import type { InMemoryRateLimiter } from '../../infrastructure/ratelimit/InMemoryRateLimiter.js';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { config, isProd, sessionTtlMs } from '../config.js';
import { loginSchema, registerSchema, updateProfileSchema } from './schemas.js';
import type { GetUserUsage } from '../../application/usage/GetUserUsage.js';
import type { BuyPlan } from '../../application/usage/BuyPlan.js';
import type { UsageSummary } from '../../domain/usage/UsageSummary.js';
import type { UsageWindow } from '../../domain/usage/UsageWindow.js';
import { RUB_PER_USD } from '../../domain/usage/pricing.js';

// Лимит размера аватара (5 МБ) — картинки профиля заведомо меньше аттачей (25 МБ).
const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

type Deps = {
  readonly register: Register;
  readonly login: Login;
  readonly logout: Logout;
  readonly updateProfile: UpdateProfile;
  readonly uploadAvatar: UploadUserAvatar;
  // Usage/тарифы (db/082+084): чтение лимитов и self-serve смена плана.
  readonly getUserUsage: GetUserUsage;
  readonly buyPlan: BuyPlan;
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

// Тело смены плана (self-serve). ВИП недоступен self-serve (только админ-выдача) — отсекаем
// на входе; Прайм = разовый пробный час (логика в BuyPlan).
const changePlanSchema = z.object({ plan: z.enum(['free', 'prime']) });

// Сериализация usage: суммы в USD (бюджет в долларах), rubPerUsd — для витрины «≈ ₽».
function serializeWindow(w: UsageWindow) {
  return {
    label: w.label,
    spentUsd: w.spentUsd,
    capUsd: w.capUsd,
    remainingUsd: w.remainingUsd,
    isOver: w.isOver,
    resetsAt: w.resetsAt ? w.resetsAt.toISOString() : null,
  };
}

function serializeUsage(s: UsageSummary) {
  return {
    plan: s.plan,
    subscription: {
      plan: s.subscription.plan,
      startedAt: s.subscription.startedAt ? s.subscription.startedAt.toISOString() : null,
      expiresAt: s.subscription.expiresAt ? s.subscription.expiresAt.toISOString() : null,
    },
    windows: {
      fiveHour: serializeWindow(s.fiveHour),
      sevenDay: serializeWindow(s.sevenDay),
    },
    isBlocked: s.isBlocked,
    blockedWindow: s.blockedWindow,
    rubPerUsd: RUB_PER_USD,
    primeTrialAvailable: s.primeTrialAvailable,
  };
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

  // Usage (лимиты + расход) текущего юзера: два скользящих окна 5ч/7д. Клиент опрашивает
  // периодически + по событиям воркера. См. план gleaming-munching-locket (M2).
  router.get('/me/usage', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const summary = await deps.getUserUsage.execute(req.user!.id);
      res.json(serializeUsage(summary));
    } catch (e) {
      next(e);
    }
  });

  // Self-serve смена тарифа («покупка» без реального биллинга) → возвращаем свежий usage.
  router.post('/me/plan', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = changePlanSchema.parse(req.body);
      await deps.buyPlan.execute(req.user!.id, body.plan);
      const summary = await deps.getUserUsage.execute(req.user!.id);
      res.json(serializeUsage(summary));
    } catch (e) {
      next(e);
    }
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

  // Загрузка аватара — multipart/form-data, поле 'file'. Принимаем любые картинки
  // (png/jpeg/webp/gif/avif…), лимит 5 МБ. memoryStorage → буфер уходит в use-case.
  const avatarUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: AVATAR_MAX_BYTES },
  });
  router.post(
    '/me/avatar',
    requireAuth,
    avatarUpload.single('file'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const file = req.file;
        if (!file) {
          res.status(400).json({ error: 'no_file', message: 'Файл не приложен' });
          return;
        }
        if (!file.mimetype.startsWith('image/')) {
          res.status(400).json({ error: 'not_image', message: 'Можно загрузить только изображение' });
          return;
        }
        const updated = await deps.uploadAvatar.execute({
          userId: req.user!.id,
          mimeType: file.mimetype,
          data: file.buffer,
        });
        res.json({ user: publicUser(updated) });
      } catch (e) {
        next(e);
      }
    },
  );

  return router;
}
