import express, {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import type { TelegramDigestActionService } from '../../application/digest/TelegramDigestActionService.js';
import { escapeHtml } from '../../domain/task/digestFormat.js';

type Deps = {
  readonly service: TelegramDigestActionService;
};

function page(title: string, content: string): string {
  return (
    '<!doctype html><html lang="ru"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<title>${escapeHtml(title)} · ProjectsFlow</title></head>` +
    '<body style="margin:0;background:#f7f8fa;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#1f2937">' +
    '<main style="max-width:420px;margin:0 auto;padding:32px 16px">' +
    '<section style="background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:24px">' +
    '<div style="font-weight:800;color:#2563eb;margin-bottom:14px">ProjectsFlow</div>' +
    content +
    '</section></main></body></html>'
  );
}

function errorPage(message: string): string {
  return page(
    'Не удалось завершить задачу',
    `<p style="margin:0;line-height:1.5">${escapeHtml(message)}</p>`,
  );
}

export function telegramDigestActionsRouter(deps: Deps): Router {
  const router = Router();
  router.use(express.urlencoded({ extended: false, limit: '8kb' }));

  router.get('/:token', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = req.params['token'] as string;
      const preview = await deps.service.preview(token);
      if (preview.kind === 'invalid') {
        return void res
          .status(404)
          .type('html')
          .send(errorPage('Ссылка недействительна.'));
      }
      if (preview.kind === 'expired') {
        return void res
          .status(410)
          .type('html')
          .send(errorPage('Срок действия ссылки истёк.'));
      }
      if (preview.action !== 'complete') {
        return void res
          .status(404)
          .type('html')
          .send(errorPage('Ссылка недействительна.'));
      }
      const action = `/api/telegram-digest-actions/${escapeHtml(token)}`;
      return void res.type('html').send(
        page(
          preview.alreadyUsed ? 'Обновляем сообщение' : 'Завершаем задачу',
          `<p style="margin:0 0 12px">${
            preview.alreadyUsed ? 'Обновляем отметку' : 'Завершаем'
          } «${escapeHtml(preview.taskName)}»…</p>` +
            `<form id="complete" method="post" action="${action}">` +
            '<noscript><button type="submit" style="border:0;border-radius:10px;padding:11px 16px;background:#16a34a;color:#fff;font-weight:700">Завершить</button></noscript>' +
            '</form><script>document.getElementById("complete").submit()</script>',
        ),
      );
    } catch (error) {
      next(error);
    }
  });

  router.post('/:token', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = req.params['token'] as string;
      const result = await deps.service.complete(token);
      if (result.kind === 'done' || result.kind === 'used') {
        return void res.type('html').send(
          page(
            'Задача завершена',
            '<p style="margin:0;color:#16a34a;font-size:17px;font-weight:800">● Задача завершена</p>' +
              '<p style="margin:8px 0 0;color:#6b7280;font-size:13px">Сообщение в Telegram обновлено.</p>' +
              '<script>setTimeout(function(){try{window.close()}catch(e){}},500)</script>',
          ),
        );
      }
      if (result.kind === 'expired') {
        return void res
          .status(410)
          .type('html')
          .send(errorPage('Срок действия ссылки истёк.'));
      }
      return void res
        .status(400)
        .type('html')
        .send(errorPage('Не удалось завершить задачу. Возможно, она удалена или изменились права.'));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
