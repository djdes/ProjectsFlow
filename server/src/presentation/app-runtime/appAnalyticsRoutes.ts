import { Router, type Request, type Response, type NextFunction } from 'express';
import type { RecordAppVisit } from '../../application/app-backend/RecordAppVisit.js';

export type AppAnalyticsDeps = {
  readonly recordAppVisit: RecordAppVisit;
};

// projectId ставит host-middleware по site-slug поддомена в req.appProjectId ДО передачи сюда
// (клиент подделать не может). См. диспетчер в presentation/http.ts.
function projectId(req: Request): string {
  const id = (req as Request & { appProjectId?: string }).appProjectId;
  if (!id) throw new Error('appProjectId not set on request');
  return id;
}

// Публичный, НЕаутентифицированный приём визитов с опубликованного сайта (<slug>.projectsflow.ru).
// Вызывается beacon'ом фронтенда приложения. Защита от абьюза (rate-limit + дневной потолок) —
// внутри RecordAppVisit. Ответ всегда 202 без деталей: не даём зондировать состояние лимита/потолка
// (это был бы булев оракул), и beacon не должен падать громко.
export function appAnalyticsRouter(deps: AppAnalyticsDeps): Router {
  const router = Router();

  router.post('/api/_analytics/visit', (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      const body = req.body && typeof req.body === 'object' ? (req.body as { path?: unknown }) : {};
      // sessionSeed — транзитный (ip + UA), нужен только для подсчёта уникальных сессий; НЕ хранится
      // (из него выводится посоленный, ротируемый по дню session_hash — см. RecordAppVisit).
      const ua = req.get('user-agent') ?? null;
      const sessionSeed = `${req.ip ?? ''}|${ua ?? ''}`;
      await deps.recordAppVisit.record({
        projectId: projectId(req),
        path: body.path,
        userAgent: ua,
        sessionSeed,
      });
      res.status(202).json({ ok: true });
    })().catch(next);
  });

  return router;
}
