import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import type { ConnectTelegramAccount } from '../../application/telegram/ConnectTelegramAccount.js';
import {
  TelegramAlreadyLinkedError,
  TelegramAuthExpiredError,
  TelegramAuthInvalidHashError,
} from '../../application/telegram/ConnectTelegramAccount.js';
import type { GetTelegramStatus } from '../../application/telegram/GetTelegramStatus.js';
import type { UserRepository } from '../../application/user/UserRepository.js';

const NOTIF_KINDS = [
  'commentOnMyTask',
  'mention',
  'statusChange',
  'ralphQuestion',
  'ralphAnswer',
  'taskDone',
] as const;

// Payload от Telegram Login Widget — все поля идут как строки в data-onauth callback,
// но мы их парсим в нужные типы перед verify. id и auth_date обязательны.
const connectPayloadSchema = z.object({
  id: z.coerce.number().int().positive(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  photo_url: z.string().optional(),
  auth_date: z.coerce.number().int().positive(),
  hash: z.string().regex(/^[a-f0-9]{64}$/i, 'invalid hash'),
});

// Partial: можно прислать только те ключи, что меняем.
const updatePrefsSchema = z.object(
  Object.fromEntries(NOTIF_KINDS.map((k) => [k, z.boolean().optional()])),
);

type Deps = {
  readonly connect: ConnectTelegramAccount;
  readonly status: GetTelegramStatus;
  readonly users: UserRepository;
};

export function meTelegramRouter(deps: Deps): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const status = await deps.status.execute(req.user!.id);
      res.json(status);
    } catch (e) {
      next(e);
    }
  });

  router.post('/connect', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const payload = connectPayloadSchema.parse(req.body);
      await deps.connect.execute(req.user!.id, payload);
      const status = await deps.status.execute(req.user!.id);
      res.json({ ok: true, ...status });
    } catch (e) {
      if (e instanceof TelegramAuthInvalidHashError) {
        res.status(400).json({ error: 'invalid_hash', message: 'Подпись Telegram некорректна' });
        return;
      }
      if (e instanceof TelegramAuthExpiredError) {
        res.status(400).json({ error: 'auth_expired', message: 'Данные TG-логина устарели (>24 ч)' });
        return;
      }
      if (e instanceof TelegramAlreadyLinkedError) {
        res
          .status(409)
          .json({ error: 'tg_already_linked', message: 'Этот Telegram уже привязан к другому аккаунту' });
        return;
      }
      next(e);
    }
  });

  router.delete('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      await deps.users.clearTelegramLink(req.user!.id);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  router.patch('/prefs', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const prefs = updatePrefsSchema.parse(req.body);
      // Берём только заданные ключи (drop'аем undefined через JSON-roundtrip).
      const cleaned = Object.fromEntries(
        Object.entries(prefs).filter(([, v]) => typeof v === 'boolean'),
      );
      await deps.users.updateTelegramPrefs(req.user!.id, cleaned);
      const status = await deps.status.execute(req.user!.id);
      res.json(status);
    } catch (e) {
      next(e);
    }
  });

  return router;
}
