/**
 * К какому виду относится проект с точки зрения студии.
 *
 * Платформа НЕ исполняет пользовательский код: она раздаёт статическую сборку и обслуживает
 * `/api/auth` и `/api/data` на поддомене приложения. Значит проект со своим сервером не
 * заработает здесь никогда — а студия до сих пор обещала ему «Preview появится после первого
 * запуска», то есть врала бесконечно.
 *
 * Классификация нужна ровно для честного статуса, поэтому она СОЗНАТЕЛЬНО консервативна:
 * `server_app` ставится только при явных признаках. Сомнение трактуется как `unknown`, и
 * поведение остаётся прежним — лучше промолчать, чем ошибочно сказать «ваш проект не
 * поддерживается» тому, у кого всё в порядке.
 */
export type ProjectRuntimeKind =
  // Статика (возможно, поверх бэкенда платформы) — студия работает штатно.
  | 'static'
  // Приносит собственный серверный процесс: исполнять его негде, нужна конверсия.
  | 'server_app'
  // Не удалось определить: нет package.json, он не разобран или сигналов не хватило.
  | 'unknown';

// Пакеты, которые существуют только ради собственного серверного процесса.
const SERVER_FRAMEWORKS = [
  'express', 'fastify', 'koa', 'hapi', '@nestjs/core', 'next', 'nuxt', 'remix',
  '@remix-run/serve', 'socket.io', 'ws',
];

// Драйверы внешних БД. SQLite сюда НЕ входит: у платформы своя SQLite на проект, и приложение
// вполне может ссылаться на неё в devDependencies, не поднимая при этом сервер.
const DB_DRIVERS = ['mysql', 'mysql2', 'pg', 'postgres', 'mongodb', 'mongoose', 'redis', 'ioredis', 'knex', '@prisma/client'];

// Запуск долгоживущего процесса. `node build.js` серверным не считаем — важен именно
// watch/serve или запуск файла, похожего на сервер.
const SERVER_START = /\b(nodemon|ts-node-dev|pm2|next\s+start|nest\s+start|fastify\s+start)\b|\bnode\s+(--watch\s+)?[\w./-]*(server|app|index|main)\.(m?js|cjs|ts)\b/i;

type PackageJson = {
  scripts?: Record<string, unknown>;
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
};

function parse(text: string | null | undefined): PackageJson | null {
  if (typeof text !== 'string' || text.trim() === '') return null;
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as PackageJson;
  } catch {
    return null;
  }
}

function names(record: Record<string, unknown> | undefined): string[] {
  return record && typeof record === 'object' ? Object.keys(record) : [];
}

/**
 * Признаки, по которым проект отнесён к `server_app`. Возвращаются наружу, чтобы студия
 * могла объяснить пользователю ПОЧЕМУ, а не просто отказать: «не поддерживается» без
 * причины выглядит как поломка платформы.
 */
export type ProjectRuntimeSignals = {
  readonly kind: ProjectRuntimeKind;
  readonly reasons: readonly string[];
};

export function detectProjectRuntime(packageJsonText: string | null | undefined): ProjectRuntimeSignals {
  const pkg = parse(packageJsonText);
  if (!pkg) return { kind: 'unknown', reasons: [] };

  const deps = [...names(pkg.dependencies), ...names(pkg.devDependencies)];
  const reasons: string[] = [];

  const frameworks = SERVER_FRAMEWORKS.filter((f) => deps.includes(f));
  if (frameworks.length > 0) reasons.push(`серверный фреймворк: ${frameworks.join(', ')}`);

  const drivers = DB_DRIVERS.filter((d) => deps.includes(d));
  if (drivers.length > 0) reasons.push(`драйвер внешней БД: ${drivers.join(', ')}`);

  const scripts = pkg.scripts ?? {};
  for (const key of ['start', 'dev', 'serve']) {
    const value = scripts[key];
    if (typeof value === 'string' && SERVER_START.test(value)) {
      reasons.push(`скрипт ${key} поднимает процесс: ${value}`);
      break;
    }
  }

  if (reasons.length === 0) return { kind: 'static', reasons: [] };
  return { kind: 'server_app', reasons };
}

/** Короткая форма, когда причины не нужны. */
export function classifyProjectRuntime(packageJsonText: string | null | undefined): ProjectRuntimeKind {
  return detectProjectRuntime(packageJsonText).kind;
}
