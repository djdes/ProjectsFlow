import express, { Router, type NextFunction, type Request, type Response } from 'express';
import type { MailingService } from '../../application/mailing/MailingService.js';
import type { MailingCampaign, MailingTemplate } from '../../domain/mailing/Mailing.js';
import { MailingError } from '../../domain/mailing/errors.js';
import { parseMailingAudience } from '../../domain/mailing/audience.js';
import { escapeMailingHtml as esc } from '../../domain/mailing/renderMailingBody.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';

type Deps = { readonly service: MailingService };

const templateToDto = (t: MailingTemplate): Record<string, unknown> => ({
  ...t, createdAt: t.createdAt.toISOString(), updatedAt: t.updatedAt.toISOString(),
});

const campaignToDto = (c: MailingCampaign): Record<string, unknown> => ({
  ...c,
  createdAt: c.createdAt.toISOString(),
  finishedAt: c.finishedAt?.toISOString() ?? null,
  cancelledAt: c.cancelledAt?.toISOString() ?? null,
});

const STATUS_BY_CODE: Record<MailingError['code'], number> = {
  template_not_found: 404,
  campaign_not_found: 404,
  workspace_not_found: 404,
  invalid_content: 400,
  audience_empty: 409,
  audience_changed: 409,
  request_conflict: 409,
  not_cancellable: 409,
  test_rate_limited: 429,
};

type Handler = (req: Request, res: Response) => Promise<void>;
const route = (fn: Handler) => (req: Request, res: Response, next: NextFunction): void => {
  fn(req, res).catch(next);
};

function audienceFrom(raw: unknown) {
  const audience = parseMailingAudience(raw);
  if (!audience) throw new MailingError('invalid_content', 'Аудитория указана неверно');
  return audience;
}

/** Admin-only mailing API, mounted at /api/admin/mailings (before the generic /api/admin). */
export function adminMailingRouter(deps: Deps): Router {
  const router = Router();
  router.use(requireAuth, requireAdmin);
  const { service } = deps;
  const admin = (req: Request) => ({ id: req.user!.id, email: req.user!.email, displayName: req.user!.displayName });

  router.get('/templates', route(async (_req, res) => {
    const templates = await service.listTemplates();
    res.json({ templates: templates.map(templateToDto), starters: service.starters() });
  }));
  router.post('/templates', route(async (req, res) => {
    res.status(201).json({ template: templateToDto(await service.createTemplate(req.body, req.user!.id)) });
  }));
  router.put('/templates/:id', route(async (req, res) => {
    res.json({ template: templateToDto(await service.updateTemplate(req.params['id'] as string, req.body)) });
  }));
  router.delete('/templates/:id', route(async (req, res) => {
    await service.deleteTemplate(req.params['id'] as string);
    res.status(204).end();
  }));

  router.post('/preview', route(async (req, res) => {
    res.json(await service.preview(req.body, admin(req)));
  }));
  router.post('/test', route(async (req, res) => {
    res.json(await service.sendTest(req.body, admin(req)));
  }));

  router.get('/audience/workspaces', route(async (_req, res) => {
    res.json({ workspaces: await service.listWorkspaceOptions() });
  }));
  router.post('/reach', route(async (req, res) => {
    res.json({ reach: await service.reach(audienceFrom((req.body ?? {}).audience)) });
  }));

  router.get('/campaigns', route(async (_req, res) => {
    res.json({ campaigns: (await service.listCampaigns()).map(campaignToDto) });
  }));
  router.post('/campaigns', route(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const requestId = body['requestId'];
    const templateId = body['templateId'];
    const expectedReach = body['expectedReach'];
    if (typeof requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(requestId)
      || typeof templateId !== 'string' || typeof expectedReach !== 'number') {
      throw new MailingError('invalid_content', 'Нужны requestId, templateId и expectedReach');
    }
    const campaign = await service.launch(
      { requestId: requestId.toLowerCase(), templateId, audience: audienceFrom(body['audience']), expectedReach },
      req.user!.id,
    );
    res.status(201).json({ campaign: campaignToDto(campaign) });
  }));
  router.get('/campaigns/:id', route(async (req, res) => {
    const { campaign, problems } = await service.getCampaign(req.params['id'] as string);
    res.json({ campaign: campaignToDto(campaign), problems });
  }));
  router.post('/campaigns/:id/cancel', route(async (req, res) => {
    res.json({ campaign: campaignToDto(await service.cancel(req.params['id'] as string)) });
  }));

  router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (!(error instanceof MailingError)) return next(error);
    res.status(STATUS_BY_CODE[error.code]).json({ error: error.code, message: error.message });
  });
  return router;
}

function page(title: string, inner: string): string {
  return '<!doctype html><html lang="ru"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">'
    + `<title>${esc(title)} · ProjectsFlow</title></head>`
    + '<body style="margin:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0f172a;">'
    + '<div style="max-width:480px;margin:0 auto;padding:40px 16px;">'
    + '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:28px 24px;">'
    + '<div style="font-size:13px;font-weight:700;letter-spacing:.5px;color:#2563eb;margin:0 0 16px;">PROJECTSFLOW</div>'
    + `<h1 style="margin:0 0 10px;font-size:20px;line-height:1.3;">${esc(title)}</h1>${inner}</div></div></body></html>`;
}

const P = 'style="margin:0 0 16px;font-size:15px;line-height:1.5;color:#334155;"';

/**
 * Public unsubscribe, mounted at /api/mailing/unsubscribe. GET never changes anything
 * (mail scanners open links on their own); POST from the page button or the RFC 8058
 * one-click request (List-Unsubscribe=One-Click) does the unsubscribe.
 */
export function mailingUnsubscribeRouter(deps: Deps): Router {
  const router = Router();
  router.use(express.urlencoded({ extended: false, limit: '4kb' }));
  const noStore = (res: Response): Response => res.set('Cache-Control', 'no-store').set('Referrer-Policy', 'no-referrer');

  router.get('/:token', route(async (req, res) => {
    const token = req.params['token'] as string;
    const p = await deps.service.previewUnsubscribe(token);
    noStore(res);
    if (p.kind === 'invalid') {
      res.status(404).type('html').send(page('Ссылка недействительна', `<p ${P}>Ссылка для отписки повреждена или устарела.</p>`));
      return;
    }
    if (p.alreadyUnsubscribed) {
      res.type('html').send(page('Вы уже отписаны', `<p ${P}>Адрес ${esc(p.maskedEmail)} не получает рассылки ProjectsFlow. Служебные письма о задачах и доступе продолжат приходить.</p>`));
      return;
    }
    res.type('html').send(page('Отписаться от рассылок?', `<p ${P}>Адрес ${esc(p.maskedEmail)} перестанет получать новости и обновления ProjectsFlow. Служебные письма о задачах и доступе продолжат приходить.</p>`
      + `<form method="post" action="/api/mailing/unsubscribe/${esc(encodeURIComponent(token))}"><input type="hidden" name="confirm" value="unsubscribe">`
      + '<button type="submit" style="cursor:pointer;border:0;background:#2563eb;color:#fff;font-weight:600;font-size:15px;padding:12px 22px;border-radius:10px;">Отписаться</button></form>'));
  }));

  router.post('/:token', route(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const oneClick = body['List-Unsubscribe'] === 'One-Click';
    noStore(res);
    if (!oneClick && body['confirm'] !== 'unsubscribe') {
      res.status(400).type('html').send(page('Не получилось', `<p ${P}>Откройте ссылку из письма ещё раз.</p>`));
      return;
    }
    const r = await deps.service.unsubscribe(req.params['token'] as string);
    if (r.kind === 'invalid') {
      res.status(404).type('html').send(page('Ссылка недействительна', `<p ${P}>Ссылка для отписки повреждена или устарела.</p>`));
      return;
    }
    if (oneClick) { res.status(200).json({ ok: true }); return; }
    res.type('html').send(page('Вы отписались', `<p ${P}>Адрес ${esc(r.maskedEmail)} больше не будет получать рассылки ProjectsFlow.</p>`));
  }));
  return router;
}
