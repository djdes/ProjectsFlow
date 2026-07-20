import { Router, type NextFunction, type Request, type Response } from 'express';
import type { AppAuthService, AppUser } from '../../application/app-backend/AppAuthService.js';
import type { BulkUpdateItem, RunAppQuery } from '../../application/app-backend/RunAppQuery.js';
import type { Row } from '../../application/app-backend/AppDatabaseStore.js';
import type { AppDashboardSettingsRepository } from '../../application/app-backend/AppDashboardSettings.js';
import { DEFAULT_APP_DASHBOARD_SETTINGS } from '../../application/app-backend/AppDashboardSettings.js';
import {
  AppAccessDeniedError,
  AppAuthError,
  AppBackendNotProvisionedError,
  AppSchemaInvalidError,
  AppTableNotAllowedError,
  AppUniqueViolationError,
  AppUserExistsError,
  StorageQuotaExceededError,
} from '../../domain/app-backend/errors.js';

export type AppRuntimeDeps = {
  readonly authService: AppAuthService;
  readonly runQuery: RunAppQuery;
  readonly settings: AppDashboardSettingsRepository;
};

// projectId ставится host-middleware'ом (по site-slug поддомена) в req.appProjectId ДО передачи
// сюда — клиент его подделать не может.
function projectId(req: Request): string {
  const id = (req as Request & { appProjectId?: string }).appProjectId;
  if (!id) throw new Error('appProjectId not set on request');
  return id;
}

function bearerToken(req: Request): string {
  const h = req.headers.authorization;
  return h && h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

// Cookie с nonce для двойной проверки OAuth-state (привязка flow к браузеру). httpOnly.
const OAUTH_NONCE_COOKIE = 'pf_app_oauth_nonce';

// Схема запроса для построения canonical redirect_uri колбэка. За прокси https не виден в req.protocol —
// на site-поддомене прод всегда https; localhost оставляем http для разработки.
function requestScheme(req: Request): 'https' | 'http' {
  const host = String(req.headers.host ?? '');
  const isLocal = host.startsWith('localhost') || host.startsWith('127.0.0.1');
  return isLocal ? 'http' : 'https';
}

function callbackRedirectUri(req: Request): string {
  return `${requestScheme(req)}://${String(req.headers.host ?? '')}/api/auth/google/callback`;
}

// Безопасный путь возврата внутри приложения (не открытый редирект): только same-origin путь.
function safeReturnTo(raw: unknown): string {
  return typeof raw === 'string' && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';
}

function numQ(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// Фильтр из query: всё кроме служебных ключей (sort/dir/limit/offset). Значения — как есть
// (RunAppQuery санитайзит имена полей к схеме).
function parseFilter(query: Record<string, unknown>): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(query)) {
    if (['sort', 'dir', 'limit', 'offset'].includes(k)) continue;
    out[k] = v;
  }
  return out;
}

function parseSort(query: Record<string, unknown>): { column: string; dir: 'asc' | 'desc' } | undefined {
  const col = typeof query.sort === 'string' ? query.sort : undefined;
  if (!col) return undefined;
  const dir = query.dir === 'desc' ? 'desc' : 'asc';
  return { column: col, dir };
}

// Тело bulk-запроса — либо голый массив, либо { items: [...] }. Потолок и типы проверяет RunAppQuery.
function bodyItems(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (body && typeof body === 'object' && Array.isArray((body as { items?: unknown }).items)) {
    return (body as { items: unknown[] }).items;
  }
  return [];
}

// Роутер App Runtime: /api/auth/* и /api/data/* для приложений с бэкендом. Мысли о безопасности:
// проект берётся из поддомена (req.appProjectId), пользователь — из Bearer-токена (серверная
// сессия), доступ/квота проверяются в RunAppQuery/AppAuthService. Роуты объявлены с ПОЛНЫМ путём
// (роутер диспатчится как middleware без mount-префикса).
export function appRuntimeRouter(deps: AppRuntimeDeps): Router {
  const router = Router();

  const user = (req: Request): AppUser | null => {
    const token = bearerToken(req);
    return token ? deps.authService.verify(projectId(req), token) : null;
  };

  router.post('/api/auth/signup', (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      const settings = await deps.settings.get(projectId(req)) ?? DEFAULT_APP_DASHBOARD_SETTINGS;
      if (!settings.auth.emailPassword) throw new AppAuthError('email authentication disabled');
      const r = deps.authService.signUp(projectId(req), String(req.body?.email ?? ''), String(req.body?.password ?? ''));
      res.status(201).json(r);
    })().catch(next);
  });

  router.post('/api/auth/signin', (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      const settings = await deps.settings.get(projectId(req)) ?? DEFAULT_APP_DASHBOARD_SETTINGS;
      if (!settings.auth.emailPassword) throw new AppAuthError('email authentication disabled');
      const r = deps.authService.signIn(projectId(req), String(req.body?.email ?? ''), String(req.body?.password ?? ''));
      res.json(r);
    })().catch(next);
  });

  router.get('/api/auth/config', (req: Request, res: Response, next: NextFunction) => {
    void deps.settings.get(projectId(req)).then((settings) => {
      const auth = settings?.auth ?? DEFAULT_APP_DASHBOARD_SETTINGS.auth;
      // Google — реальный статус из конфига провайдера (client_id/secret сохранены и включены).
      const google = deps.authService.googleConfigStatus(projectId(req));
      res.json({ emailPassword: auth.emailPassword, providers: {
        google: google.configured && google.enabled ? 'enabled' : google.configured ? 'setup_required' : 'disabled',
        microsoft: auth.microsoft === 'pending' ? 'setup_required' : 'disabled',
        facebook: auth.facebook === 'pending' ? 'setup_required' : 'disabled',
        apple: auth.apple === 'pending' ? 'setup_required' : 'disabled',
        sso: auth.sso === 'pending' ? 'setup_required' : 'disabled',
      } });
    }).catch(next);
  });

  // Старт входа через Google (OAuth 2.0 / OpenID Connect). Браузерная навигация: ставим httpOnly
  // cookie с nonce (двойная проверка против CSRF) и редиректим на Google. redirect_uri фиксирован
  // как canonical callback этого приложения (host → projectId host-middleware'ом, подделать нельзя).
  router.get('/api/auth/google/start', (req: Request, res: Response, next: NextFunction) => {
    try {
      const redirectUri = callbackRedirectUri(req);
      const { authorizationUrl, nonce } = deps.authService.beginGoogleSignIn(projectId(req), {
        redirectUri,
        returnTo: safeReturnTo(req.query['returnTo']),
      });
      res.cookie(OAUTH_NONCE_COOKIE, nonce, {
        httpOnly: true,
        secure: requestScheme(req) === 'https',
        sameSite: 'lax', // отправляется при top-level GET-редиректе обратно из Google.
        maxAge: 10 * 60 * 1000,
        path: '/api/auth/google',
      });
      res.redirect(authorizationUrl);
    } catch (error) {
      next(error);
    }
  });

  // Колбэк Google: обмен кода, проверка id_token, вход. Успех — редирект на returnTo с токеном в
  // fragment (`#pf_app_token=`, не в query — не утекает в логи/Referer). Ошибка — редирект с флагом.
  router.get('/api/auth/google/callback', (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      res.clearCookie(OAUTH_NONCE_COOKIE, { path: '/api/auth/google' });
      try {
        const { session, returnTo } = await deps.authService.completeGoogleSignIn(projectId(req), {
          code: typeof req.query['code'] === 'string' ? req.query['code'] : '',
          state: typeof req.query['state'] === 'string' ? req.query['state'] : '',
          cookieNonce: typeof req.cookies?.[OAUTH_NONCE_COOKIE] === 'string' ? req.cookies[OAUTH_NONCE_COOKIE] : '',
          redirectUri: callbackRedirectUri(req),
        });
        const target = new URL(returnTo, `${requestScheme(req)}://${String(req.headers.host ?? '')}`);
        res.redirect(`${target.pathname}${target.search}#pf_app_token=${encodeURIComponent(session.token)}`);
      } catch {
        // Не раскрываем причину пользователю (CSRF/tamper/verify) — нейтральный флаг ошибки.
        res.redirect('/?app_auth_error=google');
      }
    })().catch(next);
  });

  router.post('/api/auth/signout', (req: Request, res: Response) => {
    deps.authService.signOut(projectId(req), bearerToken(req));
    res.json({ ok: true });
  });

  router.get('/api/auth/me', (req: Request, res: Response) => {
    res.json({ user: user(req) });
  });

  router.get('/api/data/:table', (req: Request, res: Response, next: NextFunction) => {
    void deps.runQuery
      .execute({
        projectId: projectId(req),
        table: String(req.params.table),
        op: 'select',
        filter: parseFilter(req.query as Record<string, unknown>),
        sort: parseSort(req.query as Record<string, unknown>),
        limit: numQ(req.query.limit),
        offset: numQ(req.query.offset),
        currentUser: user(req),
      })
      .then((rows) => res.json(rows))
      .catch(next);
  });

  router.post('/api/data/:table', (req: Request, res: Response, next: NextFunction) => {
    void deps.runQuery
      .execute({ projectId: projectId(req), table: String(req.params.table), op: 'insert', values: req.body ?? {}, currentUser: user(req) })
      .then((row) => res.status(201).json(row))
      .catch(next);
  });

  // Bulk-создание записей (потолок 100, права построчно). Отдельный сегмент /bulk — до /:id-роутов.
  router.post('/api/data/:table/bulk', (req: Request, res: Response, next: NextFunction) => {
    void deps.runQuery
      .bulkInsert({ projectId: projectId(req), table: String(req.params.table), rows: bodyItems(req.body) as Row[], currentUser: user(req) })
      .then((rows) => res.status(201).json(rows))
      .catch(next);
  });

  // Bulk-обновление по списку {id, values} (права построчно, потолок 100).
  router.put('/api/data/:table/bulk', (req: Request, res: Response, next: NextFunction) => {
    void deps.runQuery
      .bulkUpdate({ projectId: projectId(req), table: String(req.params.table), items: bodyItems(req.body) as BulkUpdateItem[], currentUser: user(req) })
      .then((rows) => res.json(rows))
      .catch(next);
  });

  // Обновление по условию. Условие по чувствительной колонке отклоняется (оракул), права построчно.
  router.post('/api/data/:table/update-many', (req: Request, res: Response, next: NextFunction) => {
    const body = (req.body ?? {}) as { where?: Row; match?: Row; values?: Row };
    void deps.runQuery
      .updateMany({ projectId: projectId(req), table: String(req.params.table), where: body.where ?? body.match ?? {}, values: body.values ?? {}, currentUser: user(req) })
      .then((result) => res.json(result))
      .catch(next);
  });

  // Восстановление мягко удалённой записи (soft-delete + restore, права построчно).
  router.post('/api/data/:table/:id/restore', (req: Request, res: Response, next: NextFunction) => {
    void deps.runQuery
      .restore({ projectId: projectId(req), table: String(req.params.table), id: String(req.params.id), currentUser: user(req) })
      .then((row) => {
        if (row === null) res.status(404).json({ error: 'not_found' });
        else res.json(row);
      })
      .catch(next);
  });

  router.patch('/api/data/:table/:id', (req: Request, res: Response, next: NextFunction) => {
    void deps.runQuery
      .execute({ projectId: projectId(req), table: String(req.params.table), op: 'update', id: String(req.params.id), values: req.body ?? {}, currentUser: user(req) })
      .then((row) => {
        if (row === null) res.status(404).json({ error: 'not_found' });
        else res.json(row);
      })
      .catch(next);
  });

  router.delete('/api/data/:table/:id', (req: Request, res: Response, next: NextFunction) => {
    void deps.runQuery
      .execute({ projectId: projectId(req), table: String(req.params.table), op: 'delete', id: String(req.params.id), currentUser: user(req) })
      .then((r) => res.json(r))
      .catch(next);
  });

  // Маппинг доменных ошибок app-backend в HTTP-коды.
  router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof AppUserExistsError) return res.status(409).json({ error: 'user_exists' });
    // UNIQUE-конфликт — нейтрально, без имени колонки (не раскрываем схему и не даём оракул).
    if (err instanceof AppUniqueViolationError) return res.status(409).json({ error: 'duplicate_value' });
    if (err instanceof AppAuthError) return res.status(401).json({ error: 'auth_failed' });
    if (err instanceof AppAccessDeniedError) return res.status(403).json({ error: 'access_denied' });
    if (err instanceof StorageQuotaExceededError) return res.status(413).json({ error: 'storage_full' });
    if (err instanceof AppSchemaInvalidError || err instanceof AppTableNotAllowedError) {
      return res.status(400).json({ error: 'bad_request', message: (err as Error).message });
    }
    if (err instanceof AppBackendNotProvisionedError) return res.status(404).json({ error: 'not_provisioned' });
    return next(err);
  });

  return router;
}
