// Centralized config. Читаем env один раз на старте.

const num = (raw: string | undefined, def: number): number => {
  const n = raw === undefined ? def : Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Invalid numeric env value: ${raw}`);
  return n;
};

export const config = {
  port: num(process.env.PORT, 4317),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  session: {
    cookieName: process.env.SESSION_COOKIE_NAME ?? 'pf_session',
    ttlDays: num(process.env.SESSION_TTL_DAYS, 30),
  },
  github: {
    // OAuth App Client ID. Если null — endpoints вернут 503 (integration disabled).
    clientId: process.env.GITHUB_CLIENT_ID ?? null,
  },
  runner: {
    enabled: process.env.RUNNER_ENABLED === 'true',
    signalUrl: process.env.RUNNER_SIGNAL_URL ?? 'http://127.0.0.1:4318',
  },
} as const;

export const isProd = (): boolean => config.nodeEnv === 'production';

export const sessionTtlMs = (): number => config.session.ttlDays * 24 * 60 * 60 * 1000;
