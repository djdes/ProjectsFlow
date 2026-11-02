import { Router, type Request, type Response, type NextFunction } from 'express';
import { z, ZodError } from 'zod';
import { MailingError } from '../../domain/mailing/Mailing.js';
import type { AdminMailingService } from '../../application/mailing/AdminMailingService.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';

const content = z.object({
  kind: z.enum(['message', 'news', 'offer']), subject: z.string().max(200), preheader: z.string().max(160),
  body: z.string().max(20_000), buttonText: z.string().max(100), buttonUrl: z.string().max(2000),
}).strict();
const ids = z.array(z.string().min(1).max(64)).max(5000);
const draft = z.object({ title: z.string().max(160), content, channels: z.array(z.enum(['email', 'telegram', 'site'])).max(3),
  audience: z.object({ userIds: ids, contactIds: ids, baseIds: z.array(z.string().min(1).max(140)).max(100) }).strict(),
}).strict();
const revision = z.number().int().min(1);
const page = z.coerce.number().int().min(1).max(100_000).default(1);
const optionalText = z.string().max(200).optional();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`); return Number.isFinite(parsed.getTime()) && parsed.toISOString().startsWith(value);
}).optional();
const csv = z.object({ csv: z.string().max(500_000), source: z.string().trim().min(1).max(120) }).strict();
const id = (req: Request) => z.string().min(1).max(64).parse(req.params['id']);
const actor = (req: Request) => req.user ?? null;
const handle = (action: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction): void => {
  void action(req, res).catch(error => {
    if (error instanceof ZodError) { res.status(400).json({ code: 'validation_error', error: 'Проверьте заполнение полей', fields: error.flatten().fieldErrors }); return; }
    if (error instanceof MailingError) { res.status(error.status).json({ code: error.code, error: error.message }); return; }
    next(error);
  });
};
export function mailingAdminRouter(service: AdminMailingService): Router {
  const router = Router(); router.use(requireAuth, requireAdmin);
  router.get('/overview', handle(async (req, res) => { res.json(await service.overview(actor(req))); }));
  router.get('/audience', handle(async (req, res) => {
    const query = z.object({ search: optionalText, plan: z.enum(['all', 'free', 'prime', 'vip']).optional(), registeredFrom: date, registeredTo: date,
      hasTelegram: z.enum(['true', 'false']).optional(), page }).parse(req.query);
    if (query.registeredFrom && query.registeredTo && query.registeredFrom > query.registeredTo) throw new MailingError('date_range', 'Начало периода должно быть раньше конца');
    res.json(await service.audience(actor(req), { ...query, hasTelegram: query.hasTelegram === 'true' }, query.page));
  }));
  router.get('/contacts', handle(async (req, res) => {
    const query = z.object({ search: optionalText, source: optionalText, status: z.enum(['all', 'active', 'unsubscribed', 'bounced']).optional(), page }).parse(req.query);
    res.json(await service.contacts(actor(req), query, query.page));
  }));
  router.post('/contacts', handle(async (req, res) => {
    const input = z.object({ email: z.string().max(254), name: z.string().max(160), company: z.string().max(200), source: z.string().trim().min(1).max(120) }).strict().parse(req.body);
    res.status(201).json(await service.addContact(actor(req), input));
  }));
  router.delete('/contacts/:id', handle(async (req, res) => { await service.deleteContact(actor(req), id(req)); res.status(204).end(); }));
  router.post('/imports/preview', handle(async (req, res) => { const input = csv.parse(req.body); res.json(await service.importPreview(actor(req), input.csv, input.source)); }));
  router.post('/imports', handle(async (req, res) => { const input = csv.parse(req.body); res.status(201).json(await service.importContacts(actor(req), input.csv, input.source)); }));
  router.get('/stoplist', handle(async (req, res) => { const query = z.object({ search: optionalText, page }).parse(req.query); res.json(await service.stoplist(actor(req), query.search ?? '', query.page)); }));
  router.post('/stoplist', handle(async (req, res) => { const input = z.object({ email: z.string().max(254) }).strict().parse(req.body); await service.suppress(actor(req), input.email); res.status(204).end(); }));
  router.delete('/stoplist/:email', handle(async (req, res) => { await service.unsuppress(actor(req), z.string().max(254).parse(req.params['email'])); res.status(204).end(); }));
  router.put('/settings', handle(async (req, res) => {
    const input = z.object({ enabled: z.boolean(), perMinute: z.number().int().min(1).max(300), perDay: z.number().int().min(1).max(100_000) }).strict().parse(req.body);
    res.json(await service.settings(actor(req), input));
  }));
  router.post('/reach', handle(async (req, res) => { res.json(await service.reach(actor(req), draft.parse(req.body))); }));
  router.post('/preview', handle(async (req, res) => {
    const input = z.object({ draft, userId: z.string().min(1).max(64).optional() }).strict().parse(req.body);
    res.json(await service.preview(actor(req), input.draft, input.userId));
  }));
  router.post('/campaigns', handle(async (req, res) => { res.status(201).json(await service.save(actor(req), draft.parse(req.body))); }));
  router.get('/campaigns/:id', handle(async (req, res) => { res.json(await service.details(actor(req), id(req), page.parse(req.query['page']))); }));
  router.patch('/campaigns/:id', handle(async (req, res) => {
    const input = draft.extend({ revision }).strict().parse(req.body);
    const { revision: version, ...value } = input;
    res.json(await service.save(actor(req), value, id(req), version));
  }));
  router.delete('/campaigns/:id', handle(async (req, res) => { await service.deleteDraft(actor(req), id(req)); res.status(204).end(); }));
  router.post('/campaigns/:id/launch', handle(async (req, res) => {
    const input = z.object({ revision, scheduledAt: z.string().datetime({ offset: true }).nullable().default(null) }).strict().parse(req.body);
    res.json(await service.launch(actor(req), id(req), input.revision, input.scheduledAt));
  }));
  router.post('/campaigns/:id/test', handle(async (req, res) => {
    // No recipient parameter: a test can only target the authenticated administrator.
    z.object({}).strict().parse(req.body ?? {});
    res.json({ results: await service.test(actor(req), id(req)) });
  }));
  router.post('/campaigns/:id/cancel', handle(async (req, res) => { await service.cancel(actor(req), id(req)); res.status(204).end(); }));
  router.post('/campaigns/:id/retry', handle(async (req, res) => { await service.retry(actor(req), id(req)); res.status(204).end(); }));
  return router;
}
const tokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
function publicPage(res: Response, title: string, message: string, form = false): void {
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'");
  res.type('html').send(`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · ProjectsFlow</title><body style="font-family:system-ui;margin:40px auto;padding:24px;max-width:520px;line-height:1.6"><p>ProjectsFlow</p><h1>${title}</h1><p>${message}</p>${form ? '<form method="post"><button style="padding:12px 20px;font:inherit" type="submit">Отписаться от рассылок</button></form>' : '<a href="/">Открыть ProjectsFlow</a>'}</body></html>`);
}
export function mailingPublicRouter(service: AdminMailingService): Router {
  const router = Router();
  router.get('/unsubscribe/:token', (req, res) => {
    if (!tokenSchema.safeParse(req.params['token']).success) { res.status(404); publicPage(res, 'Ссылка недействительна', 'Проверьте адрес из письма.'); return; }
    // A GET is a confirmation page. Link scanners do not unsubscribe users.
    publicPage(res, 'Отписаться от рассылок', 'Подтвердите, что больше не хотите получать рассылки ProjectsFlow. Рабочие уведомления о задачах останутся включены.', true);
  });
  router.post('/unsubscribe/:token', handle(async (req, res) => {
    const parsed = tokenSchema.safeParse(req.params['token']);
    if (!parsed.success || !await service.unsubscribe(parsed.data)) { res.status(404); publicPage(res, 'Ссылка недействительна', 'Проверьте адрес из письма.'); return; }
    publicPage(res, 'Вы отписаны', 'Этот адрес больше не будет получать рассылки ProjectsFlow.');
  }));
  router.get('/click/:token', handle(async (req, res) => {
    const parsed = tokenSchema.safeParse(req.params['token']);
    const url = parsed.success ? await service.click(parsed.data) : null;
    if (!url) { res.status(404); publicPage(res, 'Ссылка недействительна', 'Проверьте адрес из письма.'); return; }
    res.set('Referrer-Policy', 'no-referrer'); res.set('Cache-Control', 'no-store'); res.redirect(303, url);
  }));
  return router;
}
