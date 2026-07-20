import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import type { AppDatabaseStore, Row } from './AppDatabaseStore.js';
import type { AppBackendRepository } from './AppBackendRepository.js';
import { requireProjectAccess, type ProjectAccessDeps } from '../project/projectAccess.js';
import {
  AppAuthError,
  AppBackendNotProvisionedError,
  AppUserExistsError,
} from '../../domain/app-backend/errors.js';

export type AppUser = { readonly id: string; readonly email: string };
export type AppSession = { readonly user: AppUser; readonly token: string };

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 дней
const STATE_TTL_MS = 10 * 60 * 1000; // OAuth state живёт 10 минут — этого хватает на редирект в Google и обратно.

// Ключ строки `_meta`, в которой лежит конфиг Google-провайдера (per-project). Секрет — зашифрован.
const GOOGLE_CONFIG_KEY = 'auth.google';
// Непроверяемый плейсхолдер password_hash для OAuth-пользователей (без пароля). Формат `salt:hash`
// нарочно битый (не hex-хвост) — verifyPassword гарантированно вернёт false для ЛЮБОГО пароля.
const OAUTH_PASSWORD_SENTINEL = 'oauth:google';

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';

// Пароль: scrypt с случайной солью. Формат хранения `salt:hash` (hex). Встроенный crypto, без деп.
function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const orig = Buffer.from(hash, 'hex');
  if (orig.length === 0) return false; // OAuth-плейсхолдер (`oauth:google`) — паролем не входят.
  const test = scryptSync(password, salt, 64);
  return test.length === orig.length && timingSafeEqual(test, orig);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// Проверенная личность из Google id_token. Верификатор (инфра-адаптер) ОБЯЗАН к моменту возврата
// проверить: подпись RS256 по JWKS Google, iss ∈ {accounts.google.com, https://accounts.google.com},
// aud === clientId, exp в будущем. Application-слой сверх этого требует email_verified.
export type GoogleIdentity = {
  readonly sub: string;
  readonly email: string;
  readonly emailVerified: boolean;
};

// Порт внешнего провайдера Google OAuth. Инфраструктурный адаптер ходит в сеть (token endpoint +
// JWKS); в тестах подменяется фейком. Application отвечает за state/CSRF/redirect_uri/аудит, провайдер —
// только за обмен кода и криптопроверку id_token. Access/refresh токены Google наружу НЕ отдаются
// и НЕ хранятся (требование безопасности: «токены Google не хранить открытыми»).
export interface GoogleOAuthProvider {
  exchangeAndVerify(input: {
    readonly clientId: string;
    readonly clientSecret: string;
    readonly code: string;
    readonly redirectUri: string;
  }): Promise<GoogleIdentity>;
}

// Публичный статус конфига провайдера — для дашборда. Секрет НИКОГДА не входит в этот тип.
export type GoogleProviderStatus = {
  readonly configured: boolean;
  readonly enabled: boolean;
  readonly clientId: string;
};

type GoogleConfig = { readonly clientId: string; readonly secretEnc: string; readonly enabled: boolean };

type StatePayload = { readonly n: string; readonly r: string; readonly t: string; readonly e: number };

type Deps = {
  readonly appDb: AppDatabaseStore;
  readonly idGen: () => string;
  readonly now: () => Date;
  // Секрет для подписи OAuth-state (HMAC) и шифрования client_secret (AES-256-GCM). Берётся из env.
  readonly secret?: string;
  // Провайдер Google (инфра-адаптер). Без него completeGoogleSignIn честно бросает — сервер не
  // умеет проверять id_token, а фейка мы не делаем.
  readonly google?: GoogleOAuthProvider;
};

// Авторизация ЭНД-ЮЗЕРОВ приложения (отдельных от аккаунтов ProjectsFlow). Серверные сессии:
// клиенту отдаём случайный токен, в _sessions храним его SHA-256 + срок. Ревокабельно, без JWT-деп.
// Внешние провайдеры (Google) — серверный OAuth-flow: state против CSRF, валидация redirect_uri,
// проверка подписи/aud/iss id_token в провайдере, токены Google не хранятся. Все входы пишутся в
// per-project аудит (`app.user.sign_in`), откуда их собирает единая лента логов (срез 2).
export class AppAuthService {
  constructor(private readonly deps: Deps) {}

  private toUser(row: Row): AppUser {
    return { id: String(row.id), email: String(row.email) };
  }

  private createSession(projectId: string, userId: string): string {
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(this.deps.now().getTime() + SESSION_TTL_MS).toISOString();
    this.deps.appDb.insert(projectId, '_sessions', {
      token_hash: hashToken(token),
      user_id: userId,
      expires_at: expiresAt,
    });
    return token;
  }

  // Аудит входа/регистрации. Никогда не роняет сам вход (аудит — побочный эффект). detail НЕ содержит
  // email/пароля/токена: только провайдер и (для ошибок) причину — это уходит в единую ленту логов.
  private recordAuth(
    projectId: string,
    actorId: string | null,
    operation: string,
    success: boolean,
    detail: Readonly<Record<string, unknown>>,
  ): void {
    try {
      this.deps.appDb.recordAudit(projectId, { actorType: 'runtime', actorId, operation, success, detail });
    } catch {
      /* аудит не критичен для завершения операции */
    }
  }

  signUp(projectId: string, email: string, password: string): AppSession {
    const normEmail = email.trim().toLowerCase();
    if (!normEmail || !password) throw new AppAuthError('email and password required');
    if (this.deps.appDb.findOne(projectId, '_users', { email: normEmail })) {
      throw new AppUserExistsError();
    }
    const id = this.deps.idGen();
    this.deps.appDb.insert(projectId, '_users', {
      id,
      email: normEmail,
      password_hash: hashPassword(password),
      created_at: this.deps.now().toISOString(),
    });
    this.recordAuth(projectId, id, 'app.user.sign_up', true, { provider: 'password' });
    this.recordAuth(projectId, id, 'app.user.sign_in', true, { provider: 'password' });
    return { user: { id, email: normEmail }, token: this.createSession(projectId, id) };
  }

  signIn(projectId: string, email: string, password: string): AppSession {
    const normEmail = email.trim().toLowerCase();
    const row = this.deps.appDb.findOne(projectId, '_users', { email: normEmail });
    if (!row || !verifyPassword(password, String(row.password_hash))) {
      // Неуспешный вход тоже в ленте (без email/пароля) — видно перебор в Logs через «только ошибки».
      this.recordAuth(projectId, null, 'app.user.sign_in', false, { provider: 'password', reason: 'invalid_credentials' });
      throw new AppAuthError();
    }
    this.recordAuth(projectId, String(row.id), 'app.user.sign_in', true, { provider: 'password' });
    return { user: this.toUser(row), token: this.createSession(projectId, String(row.id)) };
  }

  verify(projectId: string, token: string): AppUser | null {
    if (!token) return null;
    const session = this.deps.appDb.findOne(projectId, '_sessions', { token_hash: hashToken(token) });
    if (!session) return null;
    if (new Date(String(session.expires_at)).getTime() < this.deps.now().getTime()) return null;
    const user = this.deps.appDb.findOne(projectId, '_users', { id: session.user_id });
    return user ? this.toUser(user) : null;
  }

  signOut(projectId: string, token: string): void {
    if (!token) return;
    this.deps.appDb.removeWhere(projectId, '_sessions', { token_hash: hashToken(token) });
  }

  // ── Google OAuth-провайдер ──────────────────────────────────────────────────────────────────

  private key(): Buffer {
    return scryptSync(this.deps.secret ?? 'pf-app-oauth-dev', 'pf-app-oauth-config', 32);
  }

  // AES-256-GCM. Формат `iv:tag:cipher` (base64). Ключ — из серверного секрета; сам client_secret
  // в открытом виде на диск не ложится и наружу (в статус) не отдаётся.
  private encryptSecret(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return `${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${enc.toString('base64')}`;
  }

  private decryptSecret(stored: string): string {
    const [ivB, tagB, dataB] = stored.split(':');
    if (!ivB || !tagB || !dataB) return '';
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key(), Buffer.from(ivB, 'base64'));
      decipher.setAuthTag(Buffer.from(tagB, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(dataB, 'base64')), decipher.final()]).toString('utf8');
    } catch {
      return '';
    }
  }

  private readGoogleConfig(projectId: string): GoogleConfig | null {
    const row = this.deps.appDb.findOne(projectId, '_meta', { key: GOOGLE_CONFIG_KEY });
    if (!row) return null;
    try {
      const parsed = JSON.parse(String(row.value)) as Partial<GoogleConfig>;
      if (!parsed.clientId || !parsed.secretEnc) return null;
      return { clientId: String(parsed.clientId), secretEnc: String(parsed.secretEnc), enabled: parsed.enabled === true };
    } catch {
      return null;
    }
  }

  private writeGoogleConfig(projectId: string, config: GoogleConfig): void {
    // `_meta` без id-колонки — апдейт по id невозможен, делаем upsert через remove+insert.
    this.deps.appDb.removeWhere(projectId, '_meta', { key: GOOGLE_CONFIG_KEY });
    this.deps.appDb.insert(projectId, '_meta', { key: GOOGLE_CONFIG_KEY, value: JSON.stringify(config) });
  }

  googleConfigStatus(projectId: string): GoogleProviderStatus {
    const config = this.readGoogleConfig(projectId);
    if (!config) return { configured: false, enabled: false, clientId: '' };
    return { configured: true, enabled: config.enabled, clientId: config.clientId };
  }

  // Сохранить конфиг Google-провайдера. clientSecret write-only: пустое значение при существующем
  // конфиге сохраняет прежний секрет (UI не обязан слать его повторно). Включить (enabled) можно
  // только когда есть и client_id, и секрет.
  setGoogleConfig(
    projectId: string,
    input: { readonly clientId: string; readonly clientSecret: string; readonly enabled: boolean },
  ): GoogleProviderStatus {
    const clientId = input.clientId.trim();
    if (!clientId) throw new AppAuthError('client_id required');
    const existing = this.readGoogleConfig(projectId);
    const rawSecret = input.clientSecret.trim();
    let secretEnc: string;
    if (rawSecret) secretEnc = this.encryptSecret(rawSecret);
    else if (existing) secretEnc = existing.secretEnc;
    else throw new AppAuthError('client_secret required');
    this.writeGoogleConfig(projectId, { clientId, secretEnc, enabled: input.enabled === true });
    return this.googleConfigStatus(projectId);
  }

  disableGoogle(projectId: string): GoogleProviderStatus {
    const config = this.readGoogleConfig(projectId);
    if (config) this.writeGoogleConfig(projectId, { ...config, enabled: false });
    return this.googleConfigStatus(projectId);
  }

  // Старт входа через Google: валидирует redirect_uri, генерирует state (подписанный HMAC) + nonce
  // (для двойной проверки через cookie). Возвращает authorizationUrl Google и state/nonce — cookie
  // с nonce ставит роут. redirect_uri фиксируется в state и обязан совпасть на колбэке.
  beginGoogleSignIn(
    projectId: string,
    input: { readonly redirectUri: string; readonly returnTo?: string },
  ): { readonly authorizationUrl: string; readonly state: string; readonly nonce: string } {
    const config = this.readGoogleConfig(projectId);
    if (!config || !config.enabled) throw new AppAuthError('google sign-in is not enabled');
    let uri: URL;
    try {
      uri = new URL(input.redirectUri);
    } catch {
      throw new AppAuthError('invalid redirect_uri');
    }
    // Продакшн-callback обязан быть https; localhost допускаем для локальной разработки.
    if (uri.protocol !== 'https:' && uri.hostname !== 'localhost' && uri.hostname !== '127.0.0.1') {
      throw new AppAuthError('redirect_uri must be https');
    }
    const nonce = randomBytes(16).toString('hex');
    const returnTo =
      input.returnTo && input.returnTo.startsWith('/') && !input.returnTo.startsWith('//') ? input.returnTo : '/';
    const state = this.signState({ n: nonce, r: input.redirectUri, t: returnTo, e: this.deps.now().getTime() + STATE_TTL_MS });
    const url = new URL(GOOGLE_AUTH_ENDPOINT);
    url.searchParams.set('client_id', config.clientId);
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email');
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', nonce);
    url.searchParams.set('prompt', 'select_account');
    return { authorizationUrl: url.toString(), state, nonce };
  }

  // Завершение входа через Google. Порядок проверок (все — до обмена кода):
  //  1) подпись state (HMAC) — иначе state подделан (CSRF/tamper);
  //  2) срок state — иначе просрочен;
  //  3) nonce из cookie === nonce из state — двойная проверка привязывает flow к браузеру жертвы;
  //  4) redirect_uri от Google === зафиксированный в state.
  // Затем провайдер обменивает код и проверяет id_token (подпись/aud/iss/exp). Требуем email_verified.
  async completeGoogleSignIn(
    projectId: string,
    input: { readonly code: string; readonly state: string; readonly cookieNonce: string; readonly redirectUri: string },
  ): Promise<{ readonly session: AppSession; readonly returnTo: string }> {
    if (!this.deps.google) throw new AppAuthError('google auth not configured on server');
    const config = this.readGoogleConfig(projectId);
    if (!config || !config.enabled) throw new AppAuthError('google sign-in is not enabled');
    const payload = this.verifyState(input.state);
    if (!payload) throw new AppAuthError('invalid state');
    if (payload.e < this.deps.now().getTime()) throw new AppAuthError('state expired');
    if (!input.cookieNonce || input.cookieNonce !== payload.n) throw new AppAuthError('state/cookie mismatch');
    if (input.redirectUri !== payload.r) throw new AppAuthError('redirect_uri mismatch');
    if (!input.code) throw new AppAuthError('missing authorization code');

    let identity: GoogleIdentity;
    try {
      identity = await this.deps.google.exchangeAndVerify({
        clientId: config.clientId,
        clientSecret: this.decryptSecret(config.secretEnc),
        code: input.code,
        redirectUri: input.redirectUri,
      });
    } catch {
      this.recordAuth(projectId, null, 'app.user.sign_in', false, { provider: 'google', reason: 'token_verification_failed' });
      throw new AppAuthError('google verification failed');
    }

    const email = identity.email.trim().toLowerCase();
    if (!email || !identity.emailVerified) {
      this.recordAuth(projectId, null, 'app.user.sign_in', false, { provider: 'google', reason: 'email_not_verified' });
      throw new AppAuthError('email not verified');
    }

    // Аккаунт-линкинг по проверенному Google-email: если пользователь уже есть (email/пароль или
    // прошлый Google-вход) — входим в него; иначе заводим беспарольного OAuth-пользователя.
    const existing = this.deps.appDb.findOne(projectId, '_users', { email });
    let userId: string;
    if (existing) {
      userId = String(existing.id);
    } else {
      userId = this.deps.idGen();
      this.deps.appDb.insert(projectId, '_users', {
        id: userId,
        email,
        password_hash: OAUTH_PASSWORD_SENTINEL,
        created_at: this.deps.now().toISOString(),
      });
      this.recordAuth(projectId, userId, 'app.user.sign_up', true, { provider: 'google' });
    }
    const token = this.createSession(projectId, userId);
    this.recordAuth(projectId, userId, 'app.user.sign_in', true, { provider: 'google' });
    return { session: { user: { id: userId, email }, token }, returnTo: payload.t };
  }

  private signState(payload: StatePayload): string {
    const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const sig = createHmac('sha256', this.deps.secret ?? 'pf-app-oauth-dev').update(body).digest('base64url');
    return `${body}.${sig}`;
  }

  private verifyState(state: string): StatePayload | null {
    const [body, sig] = state.split('.');
    if (!body || !sig) return null;
    const expected = createHmac('sha256', this.deps.secret ?? 'pf-app-oauth-dev').update(body).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    try {
      const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<StatePayload>;
      if (typeof parsed.n !== 'string' || typeof parsed.r !== 'string' || typeof parsed.t !== 'string' || typeof parsed.e !== 'number') {
        return null;
      }
      return { n: parsed.n, r: parsed.r, t: parsed.t, e: parsed.e };
    } catch {
      return null;
    }
  }
}

type ProviderAdminDeps = ProjectAccessDeps & {
  readonly auth: AppAuthService;
  readonly appBackends: AppBackendRepository;
  readonly appDb: AppDatabaseStore;
};

// Управление провайдерами входа ИЗ ДАШБОРДА (участник проекта, cookie-auth). В отличие от
// AppAuthService (рантайм-авторитет, без проверок доступа) — здесь стоит гейт requireProjectAccess.
// Секрет провайдера наружу не возвращается (только GoogleProviderStatus).
export class ManageAppAuthProviders {
  constructor(private readonly deps: ProviderAdminDeps) {}

  private async ensureDb(projectId: string): Promise<void> {
    const backend = await this.deps.appBackends.getByProject(projectId);
    if (!backend) throw new AppBackendNotProvisionedError(projectId);
    // Гарантируем системные таблицы (_meta/_users/_sessions/_audit_log) — конфиг живёт в _meta.
    this.deps.appDb.ensureDatabase(projectId, backend.schema ?? { tables: [] });
  }

  async getGoogle(projectId: string, userId: string): Promise<GoogleProviderStatus> {
    await requireProjectAccess(this.deps, projectId, userId, 'read_project');
    await this.ensureDb(projectId);
    return this.deps.auth.googleConfigStatus(projectId);
  }

  async saveGoogle(
    projectId: string,
    userId: string,
    input: { readonly clientId: string; readonly clientSecret: string; readonly enabled: boolean },
  ): Promise<GoogleProviderStatus> {
    await requireProjectAccess(this.deps, projectId, userId, 'update_project');
    await this.ensureDb(projectId);
    return this.deps.auth.setGoogleConfig(projectId, input);
  }

  async disableGoogle(projectId: string, userId: string): Promise<GoogleProviderStatus> {
    await requireProjectAccess(this.deps, projectId, userId, 'update_project');
    await this.ensureDb(projectId);
    return this.deps.auth.disableGoogle(projectId);
  }
}
