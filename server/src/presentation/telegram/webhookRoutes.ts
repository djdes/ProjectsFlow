import { Router, type NextFunction, type Request, type Response } from 'express';
import type {
  HandleTelegramWebhook,
  TelegramUpdate,
} from '../../application/telegram/HandleTelegramWebhook.js';

type Deps = {
  readonly handler: HandleTelegramWebhook;
  // Если задан — проверяем X-Telegram-Bot-Api-Secret-Token. NULL = принимаем всё (dev).
  readonly secretToken: string | null;
};

// /api/telegram/webhook — без requireAuth, т.к. зовёт Telegram-сервер. Защита через
// secret_token header (https://core.telegram.org/bots/api#setwebhook).
export function telegramWebhookRouter(deps: Deps): Router {
  const router = Router();

  router.post('/', async (req: Request, res: Response, _next: NextFunction) => {
    if (deps.secretToken) {
      const got = req.header('X-Telegram-Bot-Api-Secret-Token');
      if (got !== deps.secretToken) {
        // Не 401 — TG не должен retry'ить; просто игнор.
        res.status(200).json({ ok: false });
        return;
      }
    }
    // Telegram treats a 2xx response as acknowledgement. Wait until durable intake finishes.
    // On a transient DB/handler failure return 503 so Telegram retries; source_key makes that
    // delivery idempotent after a successful insert. A silent 200 here would lose the task.
    try {
      const update = req.body as TelegramUpdate;
      await deps.handler.execute(update);
    } catch (err) {
      console.warn('[tg-webhook] handler failed', err);
      res.status(503).json({ ok: false });
      return;
    }
    res.status(200).json({ ok: true });
  });

  return router;
}
