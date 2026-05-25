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
// secret_token header (https://core.telegram.org/bots/api#setwebhook). Всегда отвечаем
// 200 — Telegram retry'ит ВСЁ что не 2xx, лавиной; ошибку обработки логируем, не отдаём.
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
    // Не блокируем response — handler гоняем fire-and-forget.
    res.status(200).json({ ok: true });
    try {
      const update = req.body as TelegramUpdate;
      await deps.handler.execute(update);
    } catch (err) {
      console.warn('[tg-webhook] handler failed', err);
    }
  });

  return router;
}
