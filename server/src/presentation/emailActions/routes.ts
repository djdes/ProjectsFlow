import express, { Router, type Request, type Response, type NextFunction } from 'express';
import type { EmailActionService } from '../../application/email-action/EmailActionService.js';
import { escapeHtml } from '../../domain/task/digestFormat.js';

type Deps = {
  readonly service: EmailActionService;
  readonly appUrl: string;
};

// Публичные страницы действий из писем-сводок (без сессии — авторизация по opaque-токену).
// GET — только показ (подтверждение/форма), мутаций нет → безопасно к префетчу почтовых сканеров.
// POST — собственно завершение/коммент. Стиль — лёгкий фирменный, не SPA.

const BRAND = '#2563eb';
const OK = '#16a34a';

function shell(title: string, inner: string): string {
  return (
    '<!doctype html><html lang="ru"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<title>${escapeHtml(title)} · ProjectsFlow</title></head>` +
    '<body style="margin:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0f172a;">' +
    '<div style="max-width:520px;margin:0 auto;padding:40px 16px;">' +
    '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:28px 24px;box-shadow:0 10px 30px -12px rgba(2,6,23,.15);">' +
    `<div style="font-weight:800;font-size:18px;letter-spacing:-.02em;color:${BRAND};margin:0 0 16px;">ProjectsFlow</div>` +
    inner +
    '</div>' +
    `<p style="text-align:center;color:#94a3b8;font-size:12px;margin:16px 0 0;">Ссылка из ежедневной сводки</p>` +
    '</div></body></html>'
  );
}

function linkBtn(href: string, label: string, color: string): string {
  return (
    `<a href="${escapeHtml(href)}" style="display:inline-block;text-decoration:none;background:${color};` +
    `color:#fff;font-weight:600;font-size:14px;padding:11px 18px;border-radius:10px;">${escapeHtml(label)}</a>`
  );
}

function errorPage(message: string): string {
  return shell(
    'Ссылка недействительна',
    `<p style="font-size:15px;margin:0;color:#334155;">${escapeHtml(message)}</p>`,
  );
}

function appLink(appUrl: string, path: string): string {
  return `${appUrl.replace(/\/+$/, '')}${path}`;
}

export function emailActionsRouter(deps: Deps): Router {
  const router = Router();
  // Формы страниц шлют application/x-www-form-urlencoded.
  router.use(express.urlencoded({ extended: false, limit: '64kb' }));

  // GET — показать подтверждение (complete) или форму (comment). Без мутаций.
  router.get('/:token', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = req.params['token'] as string;
      const p = await deps.service.preview(token);
      if (p.kind === 'invalid') return void res.status(404).type('html').send(errorPage('Ссылка недействительна.'));
      if (p.kind === 'expired') return void res.status(410).type('html').send(errorPage('Срок действия ссылки истёк.'));

      const name = `«${escapeHtml(p.taskName)}»`;
      if (p.action === 'complete') {
        if (p.alreadyUsed) {
          return void res
            .type('html')
            .send(shell('Уже завершено', `<p style="font-size:15px;margin:0 0 4px;">Задача ${name} уже завершена ✓</p>`));
        }
        // Мгновенно по клику: страница САМА шлёт POST через JS (реальный браузер завершает сразу).
        // Почтовые сканеры/префетч обычно без JS → POST не уходит → случайного завершения нет.
        // <noscript> — ручная кнопка для людей с выключенным JS (сканеры её не нажимают).
        const inner =
          `<p style="font-size:15px;margin:0 0 16px;color:#334155;">Завершаем задачу ${name}…</p>` +
          `<form id="f" method="post" action="/api/email-actions/${escapeHtml(token)}">` +
          `<noscript><button type="submit" style="cursor:pointer;border:0;background:${OK};color:#fff;` +
          `font-weight:700;font-size:15px;padding:12px 22px;border-radius:10px;">✓ Завершить</button></noscript>` +
          `</form><script>document.getElementById('f').submit()</script>`;
        return void res.type('html').send(shell('Завершаем…', inner));
      }

      // comment
      const inner =
        `<p style="font-size:15px;margin:0 0 12px;color:#334155;">Комментарий к задаче ${name}</p>` +
        `<form method="post" action="/api/email-actions/${escapeHtml(token)}">` +
        `<textarea name="body" required rows="5" placeholder="Ваш комментарий…" ` +
        `style="width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:10px;padding:10px 12px;` +
        `font:inherit;font-size:14px;resize:vertical;"></textarea>` +
        `<div style="margin:14px 0 0;"><button type="submit" style="cursor:pointer;border:0;background:${BRAND};` +
        `color:#fff;font-weight:700;font-size:15px;padding:12px 22px;border-radius:10px;">Отправить</button></div></form>`;
      return void res.type('html').send(shell('Комментарий', inner));
    } catch (e) {
      next(e);
    }
  });

  // POST — выполнить действие. Тип действия берём из токена (не доверяем клиенту).
  router.post('/:token', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = req.params['token'] as string;
      const p = await deps.service.preview(token);
      if (p.kind === 'invalid') return void res.status(404).type('html').send(errorPage('Ссылка недействительна.'));
      if (p.kind === 'expired') return void res.status(410).type('html').send(errorPage('Срок действия ссылки истёк.'));

      if (p.action === 'complete') {
        const r = await deps.service.complete(token);
        if (r.kind === 'done') {
          const back = linkBtn(appLink(deps.appUrl, `/projects/${r.projectId}`), 'Открыть доску', BRAND);
          const inner =
            `<p style="font-size:18px;font-weight:700;margin:0 0 6px;color:${OK};">✓ Задача завершена</p>` +
            `<p style="font-size:13px;color:#64748b;margin:0 0 18px;">Можно закрыть эту вкладку.</p>` +
            back +
            // Попытка автозакрытия (срабатывает не во всех браузерах — это нормально).
            `<script>setTimeout(function(){try{window.close()}catch(e){}},700)</script>`;
          return void res.type('html').send(shell('Готово', inner));
        }
        if (r.kind === 'used') {
          return void res.type('html').send(shell('Уже завершено', '<p style="font-size:15px;margin:0;">Задача уже была завершена ✓</p>'));
        }
        return void res.status(400).type('html').send(errorPage('Не удалось завершить задачу. Возможно, нет прав или задача удалена.'));
      }

      // comment
      const body = typeof req.body?.body === 'string' ? req.body.body : '';
      const r = await deps.service.comment(token, body);
      if (r.kind === 'commented') {
        const open = linkBtn(appLink(deps.appUrl, `/projects/${r.projectId}?task=${r.taskId}`), 'Открыть задачу', BRAND);
        return void res
          .type('html')
          .send(shell('Отправлено', `<p style="font-size:16px;font-weight:600;margin:0 0 18px;color:${OK};">✓ Комментарий добавлен</p>${open}`));
      }
      if (r.kind === 'empty') {
        return void res.status(400).type('html').send(errorPage('Комментарий пустой.'));
      }
      return void res.status(400).type('html').send(errorPage('Не удалось добавить комментарий. Возможно, нет прав или задача удалена.'));
    } catch (e) {
      next(e);
    }
  });

  return router;
}
