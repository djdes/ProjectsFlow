// Centralized config. Читаем env один раз на старте.

const num = (raw: string | undefined, def: number): number => {
  const n = raw === undefined ? def : Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Invalid numeric env value: ${raw}`);
  return n;
};

const bool = (raw: string | undefined, def: boolean): boolean => {
  if (raw === undefined) return def;
  return raw === '1' || raw.toLowerCase() === 'true';
};

const list = (raw: string | undefined): string[] =>
  (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const smtpHost = process.env.SMTP_HOST?.trim();
const smtpUser = process.env.SMTP_USER?.trim();
const smtpPass = process.env.SMTP_PASS?.trim();
const smtpFrom = process.env.SMTP_FROM?.trim();
const smtpConfigured = Boolean(smtpHost && smtpUser && smtpPass && smtpFrom);

export const config = {
  port: num(process.env.PORT, 4317),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  appUrl: (process.env.APP_URL ?? 'http://localhost:5173').replace(/\/+$/, ''),
  brandName: process.env.BRAND_NAME ?? 'ProjectsFlow',
  cors: {
    // Список origin'ов через запятую: https://projectsflow.ru, http://localhost:4321 и т.д.
    // Пусто = разрешаем same-origin (без CORS-заголовков).
    origins: list(process.env.CORS_ORIGINS),
  },
  session: {
    cookieName: process.env.SESSION_COOKIE_NAME ?? 'pf_session',
    ttlDays: num(process.env.SESSION_TTL_DAYS, 30),
    // В проде ставится в '.projectsflow.ru' чтобы кука работала между landing и app.
    // В dev — undefined (single-host, localhost).
    cookieDomain: process.env.SESSION_COOKIE_DOMAIN || undefined,
  },
  magic: {
    tokenTtlMin: num(process.env.MAGIC_TOKEN_TTL_MIN, 15),
    rateLimitWindowMin: num(process.env.MAGIC_RATE_LIMIT_WINDOW_MIN, 10),
    rateLimitMax: num(process.env.MAGIC_RATE_LIMIT_MAX, 5),
  },
  smtp: smtpConfigured
    ? {
        host: smtpHost!,
        port: num(process.env.SMTP_PORT, 587),
        secure: bool(process.env.SMTP_SECURE, false),
        user: smtpUser!,
        pass: smtpPass!,
        from: smtpFrom!,
      }
    : null,
  github: {
    clientId: process.env.GITHUB_CLIENT_ID ?? null,
  },
  secrets: {
    masterKey: process.env.SECRETS_MASTER_KEY ?? null,
  },
} as const;

export const isProd = (): boolean => config.nodeEnv === 'production';

export const sessionTtlMs = (): number => config.session.ttlDays * 24 * 60 * 60 * 1000;

export const magicTokenTtlMs = (): number => config.magic.tokenTtlMin * 60 * 1000;

export const magicRateLimitWindowMs = (): number =>
  config.magic.rateLimitWindowMin * 60 * 1000;
